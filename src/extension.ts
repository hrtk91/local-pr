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
import * as store from './commentStore';
import { createVScodeUIAdapter } from './uiAdapter';
import { ClaudeComment } from './types';
import { UnresolvedCommentsProvider } from './unresolvedCommentsProvider';
import { ChangedFilesProvider, GitBaseContentProvider, ChangedFileDecorationProvider } from './changedFilesProvider';
import { getBranches, getRecentCommits, getHeadDescription } from './gitService';

// Re-export for external use
export { ClaudeComment } from './types';

// ============================================================
// Module State
// ============================================================

let watcher: vscode.FileSystemWatcher | undefined;
let currentWorkspacePath: string | undefined;
let unresolvedCommentsProvider: UnresolvedCommentsProvider | undefined;
let changedFilesProvider: ChangedFilesProvider | undefined;

// ============================================================
// Activation
// ============================================================

export function activate(context: vscode.ExtensionContext) {
  console.log('Local Review Comments extension activated (v2.0.0 - adapter layer)');

  const commentController = vscode.comments.createCommentController(
    'local-review',
    'Local Review'
  );

  commentController.commentingRangeProvider = {
    provideCommentingRanges: (document: vscode.TextDocument) => {
      if (document.uri.scheme !== 'file') return [];
      const lineCount = document.lineCount;
      return [new vscode.Range(0, 0, lineCount - 1, 0)];
    }
  };

  context.subscriptions.push(commentController);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  // Create Unresolved Comments TreeView (always, even without workspace)
  // If no workspace, it will show empty
  const workspacePath = workspaceFolder?.uri.fsPath || '';
  console.log('[Local Review] Creating TreeView with workspace:', workspacePath);
  unresolvedCommentsProvider = new UnresolvedCommentsProvider(workspacePath);
  const treeView = vscode.window.createTreeView('localReview.unresolvedComments', {
    treeDataProvider: unresolvedCommentsProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);
  console.log('[Local Review] TreeView created and registered');

  // Early return if no workspace - but TreeView is still registered above
  if (!workspaceFolder) {
    const noopCommands = [
      'localReview.refreshComments', 'localReview.clear', 'localReview.listFiles',
      'localReview.showFileHistory', 'localReview.createComment', 'localReview.replyComment',
      'localReview.deleteComment', 'localReview.resolveComment', 'localReview.editComment',
      'localReview.saveComment', 'localReview.cancelEdit', 'localReview.jumpToComment',
      'localReview.refreshUnresolvedView', 'localReview.toggleOutdatedFilter',
      'localReview.refresh', 'localReview.toggleViewMode', 'localReview.selectBase',
      'localReview.selectTarget',
    ];
    for (const cmd of noopCommands) {
      context.subscriptions.push(vscode.commands.registerCommand(cmd, () => {}));
    }
    return;
  }

  currentWorkspacePath = workspaceFolder.uri.fsPath;

  // Create Changed Files sidebar view (Local Review) — requires workspace
  changedFilesProvider = new ChangedFilesProvider(currentWorkspacePath);

  const fileDecorationProvider = new ChangedFileDecorationProvider();
  changedFilesProvider.setDecorationProvider(fileDecorationProvider);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecorationProvider)
  );

  const changedFilesTreeView = vscode.window.createTreeView('localReview.changedFiles', {
    treeDataProvider: changedFilesProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(changedFilesTreeView);

  // Register GitBaseContentProvider for diff base content
  const gitBaseContentProvider = new GitBaseContentProvider(currentWorkspacePath);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('local-review-base', gitBaseContentProvider)
  );

  // Register Local Review commands
  const updateTreeViewDescription = () => {
    const base = changedFilesProvider!.getBaseRef();
    const shortBase = base.length > 12 ? base.substring(0, 8) + '…' : base;
    const target = changedFilesProvider!.getTargetRef();
    const targetDisplay = target === 'HEAD'
      ? getHeadDescription(currentWorkspacePath!)
      : target;
    changedFilesTreeView.description = `${shortBase} ↔ ${targetDisplay}`;
  };
  updateTreeViewDescription();
  registerLocalReviewCommands(context, changedFilesProvider, updateTreeViewDescription);
  console.log('[Local Review] Sidebar view created and registered');

  // Create UI Adapter and initialize service
  const uiAdapter = createVScodeUIAdapter(commentController, currentWorkspacePath);
  service.init(uiAdapter, currentWorkspacePath);

  const refreshOutdatedForFile = (fsPath: string) => {
    const relativePath = path.relative(currentWorkspacePath!, fsPath).replace(/\\/g, '/');
    // Skip files outside the workspace (e.g. absolute paths or ..)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return;
    }
    service.checkOutdatedForFile(relativePath);
    const includeOutdated = unresolvedCommentsProvider?.showOutdated ?? true;
    if (!includeOutdated) {
      service.loadFileComments(relativePath, false);
    }
  };

  // Initial load - all active comments (include outdated by default)
  service.loadAllActiveComments(true);

  // Watch .review/files/ directory for changes
  setupWatcher(context);

  // Re-check outdated on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      refreshOutdatedForFile(doc.uri.fsPath);
      unresolvedCommentsProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const file of event.files) {
        refreshOutdatedForFile(file.fsPath);
      }
      unresolvedCommentsProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((event) => {
      for (const file of event.files) {
        refreshOutdatedForFile(file.oldUri.fsPath);
      }
      unresolvedCommentsProvider?.refresh();
    })
  );

  // Register commands
  registerCommands(context, uiAdapter);
}

function registerCommands(context: vscode.ExtensionContext, uiAdapter: ReturnType<typeof createVScodeUIAdapter>) {
  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.refreshComments', () => {
      service.loadAllActiveComments();
      uiAdapter.showInfo('Local Review: Comments refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.clear', () => {
      service.clearAll();
      uiAdapter.showInfo('Local Review: All comments cleared');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.listFiles', async () => {
      await showReviewedFilesPicker();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.showFileHistory', async () => {
      await showFileHistory();
    })
  );

  // Comment handlers - 両方同じ処理に委譲
  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.createComment', async (reply: vscode.CommentReply) => {
      await handleCommentOrReply(reply, uiAdapter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.replyComment', async (reply: vscode.CommentReply) => {
      await handleCommentOrReply(reply, uiAdapter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.deleteComment', async (comment: ClaudeComment) => {
      await deleteComment(comment, uiAdapter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.resolveComment', async (thread: vscode.CommentThread) => {
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
    vscode.commands.registerCommand('localReview.editComment', async (comment: ClaudeComment) => {
      comment.mode = vscode.CommentMode.Editing;
      if (comment.parent) {
        comment.parent.comments = [...comment.parent.comments];
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.saveComment', async (comment: ClaudeComment) => {
      // TODO: Save edit to store
      comment.mode = vscode.CommentMode.Preview;
      if (comment.parent) {
        comment.parent.comments = [...comment.parent.comments];
      }
      uiAdapter.showInfo('Comment saved');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.cancelEdit', async (comment: ClaudeComment) => {
      comment.body = comment.savedBody;
      comment.mode = vscode.CommentMode.Preview;
      if (comment.parent) {
        comment.parent.comments = [...comment.parent.comments];
      }
    })
  );

  // Unresolved Comments TreeView commands
  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.jumpToComment', async (file: string, line: number, commentId: string) => {
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
    vscode.commands.registerCommand('localReview.refreshUnresolvedView', () => {
      unresolvedCommentsProvider?.refresh();
      uiAdapter.showInfo('Unresolved comments view refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.toggleOutdatedFilter', () => {
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
// Local Review Commands
// ============================================================

function registerLocalReviewCommands(
  context: vscode.ExtensionContext,
  provider: ChangedFilesProvider,
  updateDescription: () => void,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.refresh', () => {
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.toggleViewMode', () => {
      provider.toggleViewMode();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.selectBase', async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) return;

      const selected = await showRefPicker(workspacePath, `Base ref (current: ${provider.getBaseRef()})`);
      if (selected) {
        provider.setBaseRef(selected);
        provider.refresh();
        updateDescription();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localReview.selectTarget', async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) return;

      const selected = await showRefPicker(workspacePath, `Target ref (current: ${provider.getTargetRef()})`, true);
      if (selected) {
        provider.setTargetRef(selected);
        provider.refresh();
        updateDescription();
      }
    })
  );
}

async function showRefPicker(workspacePath: string, placeHolder: string, includeHead = false): Promise<string | undefined> {
  const items: vscode.QuickPickItem[] = [];

  if (includeHead) {
    items.push({ label: 'HEAD', description: 'working tree' });
  }

  const { local, remote } = getBranches(workspacePath);

  if (local.length > 0) {
    items.push({ label: 'Local Branches', kind: vscode.QuickPickItemKind.Separator });
    for (const b of local) items.push({ label: b });
  }

  if (remote.length > 0) {
    items.push({ label: 'Remote Branches', kind: vscode.QuickPickItemKind.Separator });
    for (const b of remote) items.push({ label: b });
  }

  const commits = getRecentCommits(workspacePath);
  if (commits.length > 0) {
    items.push({ label: 'Recent Commits', kind: vscode.QuickPickItemKind.Separator });
    for (const c of commits) {
      items.push({ label: c.hash.substring(0, 8), description: c.message });
    }
  }

  const selected = await vscode.window.showQuickPick(items, { placeHolder });
  return selected?.label;
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
  const endLine = thread.range && thread.range.end.line !== thread.range.start.line
    ? thread.range.end.line + 1
    : undefined;

  // Extract commentId from thread if it's a reply
  const rootComment = thread.comments[0] as ClaudeComment | undefined;
  const existingCommentId = rootComment?.commentId;

  // Delegate to service (分岐ロジックはService層でテスト済み)
  const result = service.handleCommentOrReply({
    file: relativePath,
    line,
    endLine,
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

  // Watch ~/.local-review/<hash>/files/*.jsonl.gz using absolute path
  const reviewStorageDir = store.getStorageDir();
  if (!reviewStorageDir) return;

  const filesDir = path.join(reviewStorageDir, 'files');
  const pattern = new vscode.RelativePattern(
    vscode.Uri.file(filesDir),
    '*.jsonl.gz'
  );

  watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const handleChange = (uri: vscode.Uri) => {
    if (service.getIsSaving()) return;

    console.log('[Local Review] File changed:', uri.fsPath);

    // Extract the target file from the storage filename
    // Format: ~/.local-review/<hash>/files/{encoded-filename}.jsonl.gz
    const fileName = path.basename(uri.fsPath, '.jsonl.gz');
    const targetFile = decodeURIComponent(fileName);

    setTimeout(() => {
      // Only reload the specific file that changed, not all files
      // This preserves the expanded/collapsed state of other threads
      const includeOutdated = unresolvedCommentsProvider?.showOutdated ?? true;
      service.loadFileComments(targetFile, includeOutdated);
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
