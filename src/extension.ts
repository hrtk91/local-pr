/**
 * Extension Entry Point - VSCode API Adapter層
 *
 * VSCode固有の処理をここに閉じ込め、
 * ビジネスロジックはcommentService経由で実行。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as service from './commentService';
import { createVScodeUIAdapter } from './uiAdapter';
import { ClaudeComment } from './types';
import { UnresolvedCommentsProvider } from './unresolvedCommentsProvider';

// Re-export for external use
export { ClaudeComment } from './types';

// ============================================================
// Module State
// ============================================================

let watcher: vscode.FileSystemWatcher | undefined;
let currentWorkspacePath: string | undefined;
let unresolvedCommentsProvider: UnresolvedCommentsProvider | undefined;

// ============================================================
// Activation
// ============================================================

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Review Comments extension activated (v2.0.0 - adapter layer)');

  const commentController = vscode.comments.createCommentController(
    'claude-review',
    'Claude Review'
  );

  commentController.commentingRangeProvider = {
    provideCommentingRanges: (document: vscode.TextDocument) => {
      const lineCount = document.lineCount;
      return [new vscode.Range(0, 0, lineCount - 1, 0)];
    }
  };

  context.subscriptions.push(commentController);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  // Create Unresolved Comments TreeView (always, even without workspace)
  // If no workspace, it will show empty
  const workspacePath = workspaceFolder?.uri.fsPath || '';
  console.log('[Claude Review] Creating TreeView with workspace:', workspacePath);
  unresolvedCommentsProvider = new UnresolvedCommentsProvider(workspacePath);
  const treeView = vscode.window.createTreeView('claudeReview.unresolvedComments', {
    treeDataProvider: unresolvedCommentsProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);
  console.log('[Claude Review] TreeView created and registered');

  // Early return if no workspace - but TreeView is still registered above
  if (!workspaceFolder) {
    return;
  }

  currentWorkspacePath = workspaceFolder.uri.fsPath;

  // Create UI Adapter and initialize service
  const uiAdapter = createVScodeUIAdapter(commentController, currentWorkspacePath);
  service.init(uiAdapter, currentWorkspacePath);

  // Initial load - all active comments (include outdated by default)
  service.loadAllActiveComments(true);

  // Watch .review/files/ directory for changes
  setupWatcher(context);

  // Re-check outdated on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const relativePath = path.relative(currentWorkspacePath!, doc.uri.fsPath).replace(/\\/g, '/');
      service.checkOutdatedForFile(relativePath);
    })
  );

  // Register commands
  registerCommands(context, uiAdapter);
}

function registerCommands(context: vscode.ExtensionContext, uiAdapter: ReturnType<typeof createVScodeUIAdapter>) {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.refresh', () => {
      service.loadAllActiveComments();
      uiAdapter.showInfo('Claude Review: Comments refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.clear', () => {
      service.clearAll();
      uiAdapter.showInfo('Claude Review: All comments cleared');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.listFiles', async () => {
      await showReviewedFilesPicker();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.showFileHistory', async () => {
      await showFileHistory();
    })
  );

  // Comment handlers - 両方同じ処理に委譲
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.createComment', async (reply: vscode.CommentReply) => {
      await handleCommentOrReply(reply, uiAdapter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.replyComment', async (reply: vscode.CommentReply) => {
      await handleCommentOrReply(reply, uiAdapter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.deleteComment', async (comment: ClaudeComment) => {
      await deleteComment(comment, uiAdapter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.resolveComment', async (thread: vscode.CommentThread) => {
      // CommentThread のルートコメントから ClaudeComment を取得
      const rootComment = thread.comments[0] as ClaudeComment | undefined;
      if (!rootComment?.targetFile || !rootComment?.commentId) {
        uiAdapter.showError('Cannot resolve comment');
        return;
      }
      if (service.resolveComment(rootComment.targetFile, rootComment.commentId)) {
        uiAdapter.showInfo('Comment resolved');
        // Refresh TreeView to remove resolved comment
        unresolvedCommentsProvider?.refresh();
      }
    })
  );

  // Edit commands (VSCode固有の処理)
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.editComment', async (comment: ClaudeComment) => {
      comment.mode = vscode.CommentMode.Editing;
      if (comment.parent) {
        comment.parent.comments = [...comment.parent.comments];
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.saveComment', async (comment: ClaudeComment) => {
      // TODO: Save edit to store
      comment.mode = vscode.CommentMode.Preview;
      if (comment.parent) {
        comment.parent.comments = [...comment.parent.comments];
      }
      uiAdapter.showInfo('Comment saved');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.cancelEdit', async (comment: ClaudeComment) => {
      comment.body = comment.savedBody;
      comment.mode = vscode.CommentMode.Preview;
      if (comment.parent) {
        comment.parent.comments = [...comment.parent.comments];
      }
    })
  );

  // Unresolved Comments TreeView commands
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.jumpToComment', async (file: string, line: number, commentId: string) => {
      if (!currentWorkspacePath) return;
      const uri = vscode.Uri.file(path.join(currentWorkspacePath, file));
      const doc = await vscode.window.showTextDocument(uri);
      const pos = new vscode.Position(line - 1, 0);
      doc.selection = new vscode.Selection(pos, pos);
      doc.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

      // Load comments for this file to display comment threads
      // Always include outdated when jumping to a specific comment (user explicitly clicked it)
      service.loadFileComments(file, true);

      // Expand the specific thread that was clicked (important for outdated comments)
      service.expandThread(file, commentId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.refreshUnresolvedView', () => {
      unresolvedCommentsProvider?.refresh();
      uiAdapter.showInfo('Unresolved comments view refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.toggleOutdatedFilter', () => {
      unresolvedCommentsProvider?.toggleOutdatedFilter();
      const state = unresolvedCommentsProvider?.getFilterState() || 'Unknown';

      // Reload all comment threads with new filter state
      const includeOutdated = unresolvedCommentsProvider?.showOutdated ?? true;
      service.loadAllActiveComments(includeOutdated);

      uiAdapter.showInfo(`Filter: ${state}`);
    })
  );
}

// ============================================================
// Comment/Reply Handler
// ============================================================

async function handleCommentOrReply(
  reply: vscode.CommentReply,
  uiAdapter: ReturnType<typeof createVScodeUIAdapter>
) {
  if (!currentWorkspacePath) return;

  const thread = reply.thread;
  const relativePath = path.relative(currentWorkspacePath, thread.uri.fsPath).replace(/\\/g, '/');
  const line = (thread.range?.start.line ?? 0) + 1;

  // Extract commentId from thread if it's a reply
  const rootComment = thread.comments[0] as ClaudeComment | undefined;
  const existingCommentId = rootComment?.commentId;

  // Delegate to service (分岐ロジックはService層でテスト済み)
  const result = service.handleCommentOrReply({
    file: relativePath,
    line,
    text: reply.text,
    existingCommentId
  });

  if (result.type === 'reply') {
    if (result.success) {
      uiAdapter.showInfo('Reply added');
      // Refresh TreeView to show new reply count
      unresolvedCommentsProvider?.refresh();
    } else {
      uiAdapter.showError('Failed to add reply');
    }
  } else {
    if (result.success && result.comment) {
      // 新規コメント: VSCodeが作った thread を再利用する（dispose しない！）
      // UIAdapter.populateThread でコメント設定と管理下への登録を行う
      uiAdapter.populateThread(thread, result.comment, 'user');
      uiAdapter.showInfo('Comment added');
      // Refresh TreeView to show new comment
      unresolvedCommentsProvider?.refresh();
    }
  }
}

// ============================================================
// Delete Handler
// ============================================================

async function deleteComment(
  comment: ClaudeComment,
  uiAdapter: ReturnType<typeof createVScodeUIAdapter>
) {
  if (!comment.parent) {
    uiAdapter.showError('Cannot identify comment to delete');
    return;
  }

  const thread = comment.parent;
  const commentIndex = thread.comments.findIndex(c => c === comment);
  const isRootComment = commentIndex === 0;

  const confirmMessage = isRootComment
    ? 'Delete this thread (including all replies)?'
    : 'Delete this reply?';

  const confirm = await vscode.window.showWarningMessage(
    confirmMessage,
    { modal: true },
    'Delete'
  );

  if (confirm !== 'Delete') {
    return;
  }

  if (isRootComment && comment.targetFile && comment.commentId) {
    service.removeComment(comment.targetFile, comment.commentId);
    uiAdapter.showInfo('Thread deleted');
    // Refresh TreeView to remove deleted comment
    unresolvedCommentsProvider?.refresh();
  } else {
    // Reply deletion is UI-only for now
    const newComments = thread.comments.filter(c => c !== comment);
    thread.comments = newComments;
    uiAdapter.showInfo('Reply deleted');
    // Refresh TreeView to update reply count
    unresolvedCommentsProvider?.refresh();
  }
}

// ============================================================
// File Operations
// ============================================================

async function showReviewedFilesPicker() {
  const files = service.getAllReviewedFiles();
  const counts = service.getActiveCommentCounts();

  if (files.length === 0) {
    vscode.window.showInformationMessage('No reviewed files found');
    return;
  }

  const items = files.map(f => ({
    label: f,
    description: `${counts.get(f) || 0} active comments`,
    filePath: f
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a file to view comments'
  });

  if (selected && currentWorkspacePath) {
    const uri = vscode.Uri.file(path.join(currentWorkspacePath, selected.filePath));
    await vscode.window.showTextDocument(uri);
    service.loadFileComments(selected.filePath);
  }
}

async function showFileHistory() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !currentWorkspacePath) {
    vscode.window.showInformationMessage('No active file');
    return;
  }

  const relativePath = path.relative(currentWorkspacePath, editor.document.uri.fsPath).replace(/\\/g, '/');
  // Use current filter state from TreeView
  const includeOutdated = unresolvedCommentsProvider?.showOutdated ?? true;
  service.loadFileComments(relativePath, includeOutdated);
  vscode.window.showInformationMessage(`Loaded comments for ${relativePath}`);
}

// ============================================================
// File Watcher (VSCode Native)
// ============================================================

function setupWatcher(context: vscode.ExtensionContext) {
  if (!currentWorkspacePath) return;

  // Watch .review/**/*.jsonl.gz files using VSCode's native FileSystemWatcher
  const pattern = new vscode.RelativePattern(
    currentWorkspacePath,
    '.review/**/*.jsonl.gz'
  );

  watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const handleChange = (uri: vscode.Uri) => {
    if (service.getIsSaving()) return;

    console.log('[Claude Review] File changed:', uri.fsPath);
    setTimeout(() => {
      // Use current filter state from TreeView
      const includeOutdated = unresolvedCommentsProvider?.showOutdated ?? true;
      service.loadAllActiveComments(includeOutdated);
      unresolvedCommentsProvider?.refresh();
    }, 100);
  };

  watcher.onDidCreate(handleChange);
  watcher.onDidChange(handleChange);
  watcher.onDidDelete(handleChange);

  context.subscriptions.push(watcher);
}

// ============================================================
// Deactivation
// ============================================================

export function deactivate() {
  watcher?.dispose();
}
