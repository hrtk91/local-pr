/**
 * Thread Manager - CommentThread UI operations only (UI Adapter)
 *
 * Handles VSCode CommentThread creation, update, and disposal.
 * Single source of truth for thread state in UI.
 * セッション廃止: ファイルパス + commentId で管理
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewComment, ClaudeComment } from './types';

// ============================================================
// State
// ============================================================

let commentController: vscode.CommentController | undefined;
let workspacePath: string | undefined;

// Thread registry: `${targetFile}:${commentId}` -> thread
const threads: Map<string, vscode.CommentThread> = new Map();

// ============================================================
// Initialization
// ============================================================

export function init(controller: vscode.CommentController, wsPath: string) {
  commentController = controller;
  workspacePath = wsPath;
}

// ============================================================
// Thread Key Helper
// ============================================================

function toKey(targetFile: string, commentId: string): string {
  return `${targetFile}:${commentId}`;
}

// ============================================================
// Thread Operations
// ============================================================

export function create(
  comment: ReviewComment,
  isOutdated: boolean,
  author: 'claude' | 'user' = 'claude'
): vscode.CommentThread | undefined {
  if (!commentController || !workspacePath) return undefined;

  const targetFile = comment.file;
  const filePath = path.join(workspacePath, targetFile);
  const uri = vscode.Uri.file(filePath);
  const startLine = Math.max(0, comment.line - 1);
  const endLine = comment.endLine ? comment.endLine - 1 : startLine;
  const range = new vscode.Range(startLine, 0, endLine, 0);

  const authorName = author === 'claude' ? 'Claude Review' : '👤 User';
  const claudeComment = new ClaudeComment(
    comment.message,
    comment.severity,
    comment.title || '',
    vscode.CommentMode.Preview,
    { name: authorName },
    targetFile,
    comment.id,
    undefined,
    comment.resolved || false,
    isOutdated
  );

  // Build comments array: main comment + replies
  const allComments: vscode.Comment[] = [claudeComment];

  if (comment.replies && comment.replies.length > 0) {
    for (const reply of comment.replies) {
      const replyComment = new ClaudeComment(
        reply.message,
        'info',
        '',
        vscode.CommentMode.Preview,
        { name: reply.author === 'claude' ? '🤖 Claude' : '👤 User' },
        targetFile,
        `${comment.id}-reply-${allComments.length}`,
        undefined,
        false,
        false
      );
      allComments.push(replyComment);
    }
  }

  const thread = commentController.createCommentThread(uri, range, allComments);
  claudeComment.parent = thread;
  thread.canReply = !isOutdated;
  thread.label = isOutdated
    ? `[outdated] ${comment.title || ''}`
    : comment.title || `Review: ${comment.severity}`;
  thread.contextValue = isOutdated ? 'outdated' : 'editable';

  if (isOutdated) {
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
  }

  const key = toKey(targetFile, comment.id);
  threads.set(key, thread);
  return thread;
}

export function get(targetFile: string, commentId: string): vscode.CommentThread | undefined {
  return threads.get(toKey(targetFile, commentId));
}

export function dispose(targetFile: string, commentId: string): boolean {
  const key = toKey(targetFile, commentId);
  const thread = threads.get(key);
  if (!thread) return false;
  thread.dispose();
  threads.delete(key);
  return true;
}

export function disposeAll() {
  for (const thread of threads.values()) {
    thread.dispose();
  }
  threads.clear();
}

export function disposeForFile(targetFile: string) {
  const prefix = `${targetFile}:`;
  const keysToDelete: string[] = [];

  for (const [key, thread] of threads.entries()) {
    if (key.startsWith(prefix)) {
      thread.dispose();
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    threads.delete(key);
  }
}

/**
 * Update a single comment within a thread.
 * Handles VSCode's requirement for full array reassignment.
 */
export function updateComment(
  targetFile: string,
  commentId: string,
  updater: (comment: ClaudeComment) => void
): boolean {
  const thread = get(targetFile, commentId);
  if (!thread || thread.comments.length === 0) return false;

  const claudeComment = thread.comments[0] as ClaudeComment;
  updater(claudeComment);

  // VSCode requires full array reassignment to trigger UI update
  thread.comments = [claudeComment, ...thread.comments.slice(1)];
  return true;
}

/**
 * Get all comment IDs for a specific file
 */
export function getCommentIdsForFile(targetFile: string): string[] {
  const result: string[] = [];
  const prefix = `${targetFile}:`;

  for (const key of threads.keys()) {
    if (key.startsWith(prefix)) {
      result.push(key.substring(prefix.length)); // Return commentId only
    }
  }
  return result;
}
