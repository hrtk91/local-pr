/**
 * Comment Facade - Unified API for comment operations (Application Service)
 *
 * Coordinates between Store (persistence) and ThreadManager (UI).
 * セッション廃止: ファイル単位でコメント管理
 */

import * as vscode from 'vscode';
import { ReviewComment, ClaudeComment } from './types';
import * as store from './commentStore';
import * as threads from './threadManager';

// ============================================================
// Initialization
// ============================================================

export function init(controller: vscode.CommentController, wsPath: string) {
  store.init(wsPath);
  threads.init(controller, wsPath);
}

export function getIsSaving(): boolean {
  return store.getIsSaving();
}

export function getWorkspacePath(): string | undefined {
  return store.getWorkspacePath();
}

// ============================================================
// File Operations
// ============================================================

/**
 * 指定ファイルのコメントを読み込んでUIに表示
 */
export function loadFileComments(targetFile: string) {
  // 既存のスレッドをクリア
  threads.disposeForFile(targetFile);

  const comments = store.load(targetFile);
  if (!comments || !Array.isArray(comments)) return;

  for (const comment of comments) {
    const isOutdated = store.isOutdated(comment);
    if (isOutdated) continue; // Skip outdated
    threads.create(comment, false, comment.author || 'claude');
  }
}

/**
 * 全ファイルのアクティブなコメントを読み込み
 */
export function loadAllActiveComments() {
  threads.disposeAll();

  const files = store.getAllReviewedFiles();
  for (const file of files) {
    const comments = store.loadActive(file);
    for (const comment of comments) {
      threads.create(comment, false, comment.author || 'claude');
    }
  }
}

/**
 * 全スレッドをクリア
 */
export function clearAll() {
  threads.disposeAll();
}

// ============================================================
// Comment Operations (Facade methods)
// ============================================================

export function addComment(
  file: string,
  line: number,
  message: string,
  options: {
    severity?: 'error' | 'warning' | 'info';
    title?: string;
    endLine?: number;
    diff_hunk?: string;
    author?: 'claude' | 'user';
  } = {}
): ReviewComment | undefined {
  // Create in store
  const newComment = store.create(file, {
    file,
    line,
    endLine: options.endLine,
    line_content: store.getLineContent(file, line),
    diff_hunk: options.diff_hunk,
    message,
    severity: options.severity || 'info',
    title: options.title || 'User Comment',
    resolved: false,
    outdated: false,
    author: options.author || 'claude',
    replies: []
  });

  // Create UI thread
  threads.create(newComment, false, options.author || 'claude');
  return newComment;
}

export function removeComment(targetFile: string, commentId: string): boolean {
  const success = store.remove(targetFile, commentId);
  if (success) {
    threads.dispose(targetFile, commentId);
  }
  return success;
}

export function updateComment(
  targetFile: string,
  commentId: string,
  updates: { message?: string; title?: string }
): boolean {
  // Update store
  const updated = store.update(targetFile, commentId, updates);
  if (!updated) return false;

  // Update UI
  threads.updateComment(targetFile, commentId, (claudeComment) => {
    if (updates.message !== undefined) {
      claudeComment.rawMessage = updates.message;
    }
    if (updates.title !== undefined) {
      claudeComment.title = updates.title;
    }
    claudeComment.body = claudeComment.formatBody();
  });

  return true;
}

export function resolveComment(targetFile: string, commentId: string): boolean {
  // Update store
  const updated = store.update(targetFile, commentId, { resolved: true });
  if (!updated) return false;

  // Update UI
  threads.updateComment(targetFile, commentId, (claudeComment) => {
    claudeComment.resolved = true;
    claudeComment.contextValue = 'resolved';
    claudeComment.body = claudeComment.formatBody();
  });

  return true;
}

export function addReply(
  targetFile: string,
  commentId: string,
  author: string,
  message: string
): boolean {
  // Add reply to store
  const success = store.addReply(targetFile, commentId, author, message);
  if (!success) return false;

  // Reload the file comments to update UI with new reply
  loadFileComments(targetFile);
  return true;
}

export function checkOutdatedForFile(changedFile: string) {
  const commentIds = threads.getCommentIdsForFile(changedFile);

  for (const commentId of commentIds) {
    const comment = store.findById(changedFile, commentId);
    if (comment && store.isOutdated(comment)) {
      // Mark as outdated in store
      store.update(changedFile, commentId, { outdated: true });
      // Remove from UI
      threads.dispose(changedFile, commentId);
    }
  }
}

// ============================================================
// Edit Mode Operations (UI-only, no persistence)
// ============================================================

export function startEdit(comment: ClaudeComment): boolean {
  if (!comment.parent || comment.outdated) return false;

  comment.savedBody = comment.body;
  comment.body = comment.rawMessage;
  comment.mode = vscode.CommentMode.Editing;

  // Trigger UI update
  comment.parent.comments = comment.parent.comments.map(c =>
    c === comment ? comment : c
  );
  return true;
}

export function cancelEdit(comment: ClaudeComment): boolean {
  if (!comment.parent) return false;

  if (comment.savedBody) {
    comment.body = comment.savedBody;
  }
  comment.mode = vscode.CommentMode.Preview;

  comment.parent.comments = comment.parent.comments.map(c =>
    c === comment ? comment : c
  );
  return true;
}

export function saveEdit(comment: ClaudeComment): boolean {
  if (!comment.parent || !comment.targetFile || !comment.commentId) {
    return false;
  }

  const newMessage = typeof comment.body === 'string'
    ? comment.body
    : comment.body.value;

  // Update both store and UI via updateComment
  const success = updateComment(comment.targetFile, comment.commentId, { message: newMessage });
  if (success) {
    comment.mode = vscode.CommentMode.Preview;
  }
  return success;
}

// ============================================================
// History Display (includes outdated)
// ============================================================

export function loadCommentsRaw(targetFile: string): ReviewComment[] {
  return store.load(targetFile);
}

export function createThreadForHistory(
  comment: ReviewComment
): vscode.CommentThread | undefined {
  const isOutdated = store.isOutdated(comment);
  return threads.create(comment, isOutdated);
}

// ============================================================
// Discovery
// ============================================================

export function getAllReviewedFiles(): string[] {
  return store.getAllReviewedFiles();
}

export function getActiveCommentCounts(): Map<string, number> {
  return store.getActiveCommentCounts();
}
