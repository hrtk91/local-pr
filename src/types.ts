/**
 * Types - Shared type definitions for the comment system
 */

import * as vscode from 'vscode';

// ============================================================
// Data Types
// ============================================================

export type ReviewComment = {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  line_content: string;
  diff_hunk?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  title?: string;
  resolved?: boolean;
  outdated?: boolean;
  created_at: string;
  author?: 'claude' | 'user';
  replies?: Array<{ author: string; message: string; timestamp: string }>;
};

export type ReviewData = {
  comments: ReviewComment[];
};

// ============================================================
// UI Comment Class
// ============================================================

export function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'error': return '🔴';
    case 'warning': return '🟡';
    case 'info': return '🟢';
    default: return '💬';
  }
}

export class ClaudeComment implements vscode.Comment {
  id: string;
  label: string | undefined;
  body: string | vscode.MarkdownString;
  savedBody: string | vscode.MarkdownString;
  rawMessage: string;
  severity: string;
  title: string;
  resolved: boolean;
  outdated: boolean;
  mode: vscode.CommentMode;
  author: vscode.CommentAuthorInformation;
  contextValue?: string;
  parent?: vscode.CommentThread;
  targetFile: string;  // ファイルパス（セッション廃止に伴い変更）
  commentId: string;

  constructor(
    rawMessage: string,
    severity: string,
    title: string,
    mode: vscode.CommentMode,
    author: vscode.CommentAuthorInformation,
    targetFile: string,
    commentId: string,
    parent?: vscode.CommentThread,
    resolved: boolean = false,
    outdated: boolean = false
  ) {
    this.id = `${Date.now()}`;
    this.rawMessage = rawMessage;
    this.severity = severity;
    this.title = title;
    this.resolved = resolved;
    this.outdated = outdated;
    this.body = this.formatBody();
    this.savedBody = this.body;
    this.mode = mode;
    this.author = author;
    this.targetFile = targetFile;
    this.commentId = commentId;
    this.parent = parent;
    this.contextValue = this.getContextValue();
  }

  getContextValue(): string {
    if (this.outdated) return 'outdated';
    if (this.resolved) return 'resolved';
    return 'editable';
  }

  formatBody(): vscode.MarkdownString {
    let icon: string;
    if (this.outdated) {
      icon = '⚪';
    } else if (this.resolved) {
      icon = '✅';
    } else {
      icon = getSeverityIcon(this.severity);
    }

    const titleText = this.title ? `**${this.title}**\n\n` : '';
    const formattedMessage = this.rawMessage.replace(/\n/g, '  \n');

    if (this.outdated) {
      return new vscode.MarkdownString(`${icon} ~~*[outdated]*~~ ${titleText}${formattedMessage}`);
    }
    if (this.resolved) {
      return new vscode.MarkdownString(`${icon} ~~${titleText}${formattedMessage}~~`);
    }
    return new vscode.MarkdownString(`${icon} ${titleText}${formattedMessage}`);
  }
}
