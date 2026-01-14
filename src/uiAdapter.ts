/**
 * UI Adapter - VSCode UI操作の抽象化層
 *
 * VSCode APIへの依存をこのファイルに閉じ込め、
 * Service層からはUIAdapter型経由でUI操作を行う。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewComment, ClaudeComment } from './types';

// ============================================================
// UIAdapter Interface (テスト可能な抽象)
// ============================================================

export type UIAdapter = {
  // Thread操作
  createThread: (comment: ReviewComment, author: 'claude' | 'user') => string;
  disposeThread: (threadId: string) => void;
  disposeAllThreads: () => void;
  disposeThreadsForFile: (file: string) => void;
  expandThread: (threadId: string) => void;

  // Thread更新
  addReplyToThread: (threadId: string, author: string, message: string) => boolean;
  updateThreadWithComment: (threadId: string, comment: ReviewComment) => boolean;

  // Thread取得
  getThread: (threadId: string) => { comments: readonly vscode.Comment[] } | undefined;
  getThreadIdsForFile: (file: string) => string[];

  // 既存スレッドにコメントを設定して管理下に登録（VSCodeが作った一時スレッドを再利用）
  populateThread: (thread: vscode.CommentThread, comment: ReviewComment, author: 'claude' | 'user') => string;

  // 通知
  showInfo: (message: string) => void;
  showError: (message: string) => void;
};

// ============================================================
// VSCode実装
// ============================================================

export function createVScodeUIAdapter(
  controller: vscode.CommentController,
  wsPath: string
): UIAdapter {
  const threads = new Map<string, vscode.CommentThread>();

  const toThreadId = (file: string, commentId: string) => `${file}:${commentId}`;

  return {
    createThread: (comment, author) => {
      const targetFile = comment.file;
      const filePath = path.join(wsPath, targetFile);
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
        comment.outdated || false
      );

      // Build comments array: main comment + replies
      const allComments: vscode.Comment[] = [claudeComment];

      if (comment.replies && comment.replies.length > 0) {
        for (const reply of comment.replies) {
          const replyAuthorName = reply.author === 'claude' ? '🤖 Claude' : '👤 User';
          const replyComment = new ClaudeComment(
            reply.message,
            'info',
            '',
            vscode.CommentMode.Preview,
            { name: replyAuthorName },
            targetFile,
            `${comment.id}-reply-${allComments.length}`,
            undefined,
            false,
            false
          );
          allComments.push(replyComment);
        }
      }

      const thread = controller.createCommentThread(uri, range, allComments);

      // Set parent for all comments (for delete functionality)
      for (const c of allComments) {
        (c as ClaudeComment).parent = thread;
      }

      thread.canReply = !comment.outdated;
      thread.label = comment.outdated
        ? `[outdated] ${comment.title || ''}`
        : comment.title || `Review: ${comment.severity}`;
      thread.contextValue = comment.outdated ? 'outdated' : 'editable';

      if (comment.outdated) {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      }

      const threadId = toThreadId(targetFile, comment.id);
      threads.set(threadId, thread);
      return threadId;
    },

    disposeThread: (threadId) => {
      const thread = threads.get(threadId);
      if (thread) {
        thread.dispose();
        threads.delete(threadId);
      }
    },

    disposeAllThreads: () => {
      for (const thread of threads.values()) {
        thread.dispose();
      }
      threads.clear();
    },

    disposeThreadsForFile: (file) => {
      const prefix = `${file}:`;
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
    },

    expandThread: (threadId) => {
      const thread = threads.get(threadId);
      if (thread) {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      }
    },

    addReplyToThread: (threadId, author, message) => {
      const thread = threads.get(threadId);
      if (!thread || thread.comments.length === 0) return false;

      // Determine author name format (match existing reply format from createThread)
      const authorName = author.toLowerCase().includes('claude')
        ? '🤖 Claude'
        : '👤 User';

      // Extract targetFile from threadId (format: "file:commentId")
      const colonIndex = threadId.lastIndexOf(':');
      const targetFile = threadId.substring(0, colonIndex);

      // Create new reply comment
      const replyComment = new ClaudeComment(
        message,
        'info',
        '',
        vscode.CommentMode.Preview,
        { name: authorName },
        targetFile,
        undefined,  // Reply doesn't have its own ID
        thread,     // Set parent thread
        false,      // Not resolved
        false       // Not outdated
      );

      // Add reply to thread (append to existing comments)
      // VSCode requires full array reassignment to trigger UI update
      thread.comments = [...thread.comments, replyComment];
      return true;
    },

    getThread: (threadId) => {
      return threads.get(threadId);
    },

    getThreadIdsForFile: (file) => {
      const prefix = `${file}:`;
      const result: string[] = [];

      for (const key of threads.keys()) {
        if (key.startsWith(prefix)) {
          result.push(key);
        }
      }
      return result;
    },

    updateThreadWithComment: (threadId, comment) => {
      const thread = threads.get(threadId);
      if (!thread) return false;

      // 既存の Reply 数とコメントの Reply 数を比較
      const currentReplyCount = thread.comments.length - 1; // 最初の1つはメインコメント
      const newReplyCount = comment.replies?.length || 0;

      if (newReplyCount > currentReplyCount) {
        // Reply が増えている → 新しい Reply を追加
        const newReplies = comment.replies!.slice(currentReplyCount);
        for (const reply of newReplies) {
          const authorName = reply.author === 'claude' ? '🤖 Claude' : '👤 User';
          const colonIndex = threadId.lastIndexOf(':');
          const targetFile = threadId.substring(0, colonIndex);

          const replyComment = new ClaudeComment(
            reply.message,
            'info',
            '',
            vscode.CommentMode.Preview,
            { name: authorName },
            targetFile,
            undefined,
            thread,
            false,
            false
          );

          thread.comments = [...thread.comments, replyComment];
        }
      }

      // Outdated/Resolved 状態の更新
      if (comment.outdated || comment.resolved) {
        thread.canReply = false;
        if (comment.outdated) {
          thread.label = `[outdated] ${comment.title || ''}`;
        }
      }

      return true;
    },

    populateThread: (thread, comment, author) => {
      // 既存スレッド（VSCodeが作った一時スレッド）にコメントを設定
      const targetFile = comment.file;
      const authorName = author === 'claude' ? 'Claude Review' : '👤 User';

      const claudeComment = new ClaudeComment(
        comment.message,
        comment.severity,
        comment.title || '',
        vscode.CommentMode.Preview,
        { name: authorName },
        targetFile,
        comment.id,
        thread, // parent を設定
        comment.resolved || false,
        comment.outdated || false
      );

      // スレッドにコメントを設定
      thread.comments = [claudeComment];
      thread.canReply = !comment.outdated;
      thread.label = comment.outdated
        ? `[outdated] ${comment.title || ''}`
        : comment.title || `Review: ${comment.severity}`;
      thread.contextValue = comment.outdated ? 'outdated' : 'editable';

      if (comment.outdated) {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      }

      // 管理下に登録
      const threadId = toThreadId(targetFile, comment.id);
      threads.set(threadId, thread);
      return threadId;
    },

    showInfo: (msg) => {
      vscode.window.showInformationMessage(msg);
    },

    showError: (msg) => {
      vscode.window.showErrorMessage(msg);
    },
  };
}

// ============================================================
// Mock実装（テスト用）
// ============================================================

export type MockThread = {
  comment: ReviewComment;
  author: 'claude' | 'user';
  comments: { commentId: string; parent: MockThread }[];
};

export function createMockUIAdapter(): UIAdapter & {
  threads: Map<string, MockThread>;
  notifications: string[];
} {
  const threads = new Map<string, MockThread>();
  const notifications: string[] = [];

  const toThreadId = (file: string, commentId: string) => `${file}:${commentId}`;

  return {
    threads,
    notifications,

    createThread: (comment, author) => {
      const threadId = toThreadId(comment.file, comment.id);
      const mockThread: MockThread = {
        comment,
        author,
        comments: [{ commentId: comment.id, parent: null as any }],
      };
      // Set parent reference
      mockThread.comments[0].parent = mockThread;

      // Add replies
      if (comment.replies) {
        for (let i = 0; i < comment.replies.length; i++) {
          mockThread.comments.push({
            commentId: `${comment.id}-reply-${i + 1}`,
            parent: mockThread,
          });
        }
      }

      threads.set(threadId, mockThread);
      return threadId;
    },

    disposeThread: (threadId) => {
      threads.delete(threadId);
    },

    disposeAllThreads: () => {
      threads.clear();
    },

    disposeThreadsForFile: (file) => {
      const prefix = `${file}:`;
      for (const key of threads.keys()) {
        if (key.startsWith(prefix)) {
          threads.delete(key);
        }
      }
    },

    expandThread: (_threadId) => {
      // Mock: no-op (テスト用なので何もしない)
    },

    addReplyToThread: (threadId, author, message) => {
      const mockThread = threads.get(threadId);
      if (!mockThread) return false;

      // Add reply to mock thread
      const replyIndex = mockThread.comments.length;
      mockThread.comments.push({
        commentId: `${mockThread.comment.id}-reply-${replyIndex}`,
        parent: mockThread,
      });

      // Update the comment in store (if needed for tests)
      // This is a simplified mock implementation
      return true;
    },

    getThread: (threadId) => {
      const mock = threads.get(threadId);
      if (!mock) return undefined;
      return {
        comments: mock.comments as any,
      };
    },

    getThreadIdsForFile: (file) => {
      const prefix = `${file}:`;
      const result: string[] = [];

      for (const key of threads.keys()) {
        if (key.startsWith(prefix)) {
          result.push(key);
        }
      }
      return result;
    },

    updateThreadWithComment: (threadId, comment) => {
      const mockThread = threads.get(threadId);
      if (!mockThread) return false;

      // Update comment data
      mockThread.comment = comment;

      // Update replies count
      if (comment.replies) {
        mockThread.comments = [
          { commentId: comment.id, parent: mockThread },
          ...comment.replies.map((r, i) => ({
            commentId: `${comment.id}-reply-${i + 1}`,
            parent: mockThread
          }))
        ];
      }

      return true;
    },

    populateThread: (_thread, comment, author) => {
      // Mock: createThread と同じ動作
      const threadId = toThreadId(comment.file, comment.id);
      const mockThread: MockThread = {
        comment,
        author,
        comments: [{ commentId: comment.id, parent: null as any }],
      };
      mockThread.comments[0].parent = mockThread;
      threads.set(threadId, mockThread);
      return threadId;
    },

    showInfo: (msg) => {
      notifications.push(`INFO: ${msg}`);
    },

    showError: (msg) => {
      notifications.push(`ERROR: ${msg}`);
    },
  };
}
