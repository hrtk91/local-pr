/**
 * Comment Service - ビジネスロジック層
 *
 * UIAdapter経由でUI操作を行うため、テスト可能。
 * VSCode APIへの直接依存なし。
 */

import { ReviewComment } from './types';
import * as store from './commentStore';
import { UIAdapter } from './uiAdapter';

// ============================================================
// State
// ============================================================

let uiAdapter: UIAdapter | undefined;

// ============================================================
// Initialization
// ============================================================

export function init(adapter: UIAdapter, wsPath: string) {
  uiAdapter = adapter;
  store.init(wsPath);
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
export function loadFileComments(targetFile: string, includeOutdated: boolean = true) {
  if (!uiAdapter) return;

  // 既存のスレッドをクリア
  uiAdapter.disposeThreadsForFile(targetFile);

  // load: 全コメント取得
  const comments = store.load(targetFile);
  if (!comments || !Array.isArray(comments)) return;

  for (const comment of comments) {
    // Filter based on settings
    if (comment.resolved) continue;
    if (!includeOutdated && comment.outdated) continue;
    uiAdapter.createThread(comment, comment.author || 'claude');
  }
}

/**
 * 全ファイルのアクティブなコメントを読み込み
 */
export function loadAllActiveComments(includeOutdated: boolean = true) {
  if (!uiAdapter) return;

  uiAdapter.disposeAllThreads();

  const files = store.getAllReviewedFiles();
  for (const file of files) {
    const comments = store.load(file);
    for (const comment of comments) {
      // Filter based on settings
      if (comment.resolved) continue;
      if (!includeOutdated && comment.outdated) continue;
      uiAdapter.createThread(comment, comment.author || 'claude');
    }
  }
}

/**
 * 全スレッドをクリア
 */
export function clearAll() {
  if (!uiAdapter) return;
  uiAdapter.disposeAllThreads();
}

/**
 * 特定のスレッドを展開（開く）
 */
export function expandThread(targetFile: string, commentId: string) {
  if (!uiAdapter) return;
  const threadId = `${targetFile}:${commentId}`;
  uiAdapter.expandThread(threadId);
}

// ============================================================
// Comment Operations
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
    skipCreateThread?: boolean; // trueならUIスレッド作成をスキップ
  } = {}
): ReviewComment | undefined {
  if (!uiAdapter) return undefined;

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

  // Create UI thread (スキップフラグがなければ)
  if (!options.skipCreateThread) {
    uiAdapter.createThread(newComment, options.author || 'claude');
  }
  return newComment;
}

export function removeComment(targetFile: string, commentId: string): boolean {
  if (!uiAdapter) return false;

  const success = store.remove(targetFile, commentId);
  if (success) {
    uiAdapter.disposeThread(`${targetFile}:${commentId}`);
  }
  return success;
}

export function resolveComment(targetFile: string, commentId: string): boolean {
  if (!uiAdapter) return false;

  const updated = store.update(targetFile, commentId, { resolved: true });
  if (updated) {
    uiAdapter.disposeThread(`${targetFile}:${commentId}`);
  }
  return !!updated;
}

export function addReply(
  targetFile: string,
  commentId: string,
  author: 'claude' | 'user',
  message: string
): boolean {
  if (!uiAdapter) return false;

  const success = store.addReply(targetFile, commentId, author, message);
  if (!success) return false;

  // UIリフレッシュ（ファイル単位で再読み込み）
  loadFileComments(targetFile);
  return true;
}

/**
 * ファイル変更時にoutdatedチェック
 */
export function checkOutdatedForFile(changedFile: string) {
  if (!uiAdapter) return;

  const comments = store.load(changedFile);
  for (const comment of comments) {
    if (store.isOutdated(comment) && !comment.outdated) {
      store.update(changedFile, comment.id, { outdated: true });
    }
  }
  // UIリフレッシュ
  loadFileComments(changedFile);
}

// ============================================================
// File Discovery (Store への委譲)
// ============================================================

export function getAllReviewedFiles(): string[] {
  return store.getAllReviewedFiles();
}

export function getActiveCommentCounts(): Map<string, number> {
  return store.getActiveCommentCounts();
}

/**
 * Get all comments for a specific file (including resolved and outdated)
 */
export function getCommentsForFile(file: string): ReviewComment[] {
  return store.load(file);
}

// ============================================================
// Comment or Reply Handler (分岐ロジック)
// ============================================================

export type CommentInput = {
  file: string;
  line: number;
  text: string;
  existingCommentId?: string; // あればReply、なければ新規
};

export function handleCommentOrReply(input: CommentInput): {
  type: 'comment' | 'reply';
  success: boolean;
  comment?: ReviewComment;
} {
  if (input.existingCommentId) {
    // Reply to existing comment
    const success = addReply(input.file, input.existingCommentId, 'user', input.text);
    return { type: 'reply', success };
  } else {
    // New comment - UIスレッド作成はスキップ（呼び出し側で populateThread する）
    const firstLine = input.text.split('\n')[0].trim();
    const title = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;

    const comment = addComment(input.file, input.line, input.text, {
      severity: 'info',
      title,
      author: 'user',
      skipCreateThread: true // 必ずスキップ
    });

    return { type: 'comment', success: !!comment, comment };
  }
}

