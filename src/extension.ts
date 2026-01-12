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

// Re-export for external use
export { ClaudeComment } from './types';

// ============================================================
// Module State
// ============================================================

let watcher: vscode.FileSystemWatcher | undefined;
let currentWorkspacePath: string | undefined;

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
  if (!workspaceFolder) {
    return;
  }

  currentWorkspacePath = workspaceFolder.uri.fsPath;

  // Create UI Adapter and initialize service
  const uiAdapter = createVScodeUIAdapter(commentController, currentWorkspacePath);
  service.init(uiAdapter, currentWorkspacePath);

  // Initial load - all active comments
  service.loadAllActiveComments();

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
    vscode.commands.registerCommand('claudeReview.resolveComment', async (comment: ClaudeComment) => {
      if (!comment.targetFile || !comment.commentId) {
        uiAdapter.showError('Cannot resolve comment');
        return;
      }
      if (service.resolveComment(comment.targetFile, comment.commentId)) {
        uiAdapter.showInfo('Comment resolved');
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
    } else {
      uiAdapter.showError('Failed to add reply');
    }
  } else {
    if (result.success && result.comment) {
      // 新規コメント: VSCodeが作った thread を再利用する（dispose しない！）
      // UIAdapter.populateThread でコメント設定と管理下への登録を行う
      uiAdapter.populateThread(thread, result.comment, 'user');
      uiAdapter.showInfo('Comment added');
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
  } else {
    // Reply deletion is UI-only for now
    const newComments = thread.comments.filter(c => c !== comment);
    thread.comments = newComments;
    uiAdapter.showInfo('Reply deleted');
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
  service.loadFileComments(relativePath);
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
      service.loadAllActiveComments();
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
