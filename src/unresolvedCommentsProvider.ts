/**
 * Unresolved Comments TreeView Provider
 *
 * Provides a hierarchical view of all unresolved comments grouped by file.
 * Displays in VSCode Panel (bottom bar) alongside Problems, Terminal, etc.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as service from './commentService';
import { ReviewComment } from './types';

// ============================================================
// TreeItem Types
// ============================================================

type TreeItemType = 'file' | 'comment';

interface FileTreeItemData {
  type: 'file';
  file: string;
  commentCount: number;
}

interface CommentTreeItemData {
  type: 'comment';
  file: string;
  comment: ReviewComment;
}

type TreeItemData = FileTreeItemData | CommentTreeItemData;

// ============================================================
// Tree Data Provider
// ============================================================

export class UnresolvedCommentsProvider implements vscode.TreeDataProvider<TreeItemData> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemData | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workspacePath: string;
  public showOutdated: boolean = true; // Default: show outdated comments (public for extension.ts to read)

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Toggle outdated comments filter
   */
  toggleOutdatedFilter(): void {
    this.showOutdated = !this.showOutdated;
    this.refresh();
  }

  /**
   * Get current filter state
   */
  getFilterState(): string {
    return this.showOutdated ? 'Showing all' : 'Active only';
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item for a given element
   */
  getTreeItem(element: TreeItemData): vscode.TreeItem {
    if (element.type === 'file') {
      return this.createFileTreeItem(element);
    } else {
      return this.createCommentTreeItem(element);
    }
  }

  /**
   * Get children for a given element (or root)
   */
  getChildren(element?: TreeItemData): TreeItemData[] {
    console.log('[Claude Review] TreeView getChildren called, element:', element?.type || 'ROOT');

    if (!element) {
      // Root: return all files with unresolved comments
      const items = this.getRootFileItems();
      console.log('[Claude Review] TreeView returning', items.length, 'root items');
      return items;
    }

    if (element.type === 'file') {
      // File: return all unresolved comments for this file
      return this.getCommentItemsForFile(element.file);
    }

    // Comments have no children
    return [];
  }

  // ============================================================
  // Private: Root Level (Files)
  // ============================================================

  private getRootFileItems(): FileTreeItemData[] {
    // Guard: if service/store not initialized yet, return empty
    if (!this.workspacePath) {
      return [];
    }

    try {
      const files = service.getAllReviewedFiles();
      const items: FileTreeItemData[] = [];

      for (const file of files) {
        const comments = service.getCommentsForFile(file);
        // Filter based on current filter state
        const unresolvedComments = comments.filter(c => {
          if (c.resolved) return false;
          if (!this.showOutdated && c.outdated) return false;
          return true;
        });

        if (unresolvedComments.length > 0) {
          items.push({
            type: 'file',
            file,
            commentCount: unresolvedComments.length
          });
        }
      }

      return items;
    } catch (e) {
      // Store not initialized yet - return empty array
      console.log('[Claude Review] TreeView: Store not initialized yet, showing empty');
      return [];
    }
  }

  // ============================================================
  // Private: File Level (Comments)
  // ============================================================

  private getCommentItemsForFile(file: string): CommentTreeItemData[] {
    try {
      const comments = service.getCommentsForFile(file);
      // Filter based on current filter state
      const unresolvedComments = comments.filter(c => {
        if (c.resolved) return false;
        if (!this.showOutdated && c.outdated) return false;
        return true;
      });

      return unresolvedComments.map(comment => ({
        type: 'comment',
        file,
        comment
      }));
    } catch (e) {
      // Store not initialized yet - return empty array
      return [];
    }
  }

  // ============================================================
  // Private: TreeItem Creation
  // ============================================================

  private createFileTreeItem(data: FileTreeItemData): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `📁 ${data.file}`,
      vscode.TreeItemCollapsibleState.Expanded
    );

    item.description = `${data.commentCount} unresolved`;
    item.contextValue = 'file';
    item.tooltip = `${data.file}\n${data.commentCount} unresolved comments`;

    return item;
  }

  private createCommentTreeItem(data: CommentTreeItemData): vscode.TreeItem {
    const comment = data.comment;
    const severityIcon = comment.outdated ? '⚪' : this.getSeverityIcon(comment.severity);
    const replyBadge = this.getReplyBadge(comment);
    const outdatedTag = comment.outdated ? '[outdated] ' : '';

    // Title format: ⚪ [outdated] [15] asfasf 💬 1 reply
    const title = comment.title || comment.message.split('\n')[0] || 'No title';
    const label = `${severityIcon} ${outdatedTag}[${comment.line}] ${title} ${replyBadge}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    item.description = comment.outdated ? 'Code changed' : ''; // Add outdated indicator
    item.contextValue = 'comment';
    item.tooltip = this.createCommentTooltip(comment);

    // Command: Jump to comment location on click
    item.command = {
      command: 'claudeReview.jumpToComment',
      title: 'Jump to Comment',
      arguments: [data.file, comment.line, comment.id]
    };

    return item;
  }

  // ============================================================
  // Private: Helpers
  // ============================================================

  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'error': return '🔴';
      case 'warning': return '🟡';
      case 'info': return '🟢';
      default: return '⚪';
    }
  }

  private getReplyBadge(comment: ReviewComment): string {
    const replyCount = comment.replies?.length || 0;
    if (replyCount === 0) {
      return '';
    }

    // TODO Phase 2: Add unread detection
    // For now, just show reply count
    return `💬 ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
  }

  private createCommentTooltip(comment: ReviewComment): string {
    const lines = [
      `Line ${comment.line}`,
      `Severity: ${comment.severity}`,
      `Author: ${comment.author || 'unknown'}`,
      `Created: ${new Date(comment.created_at).toLocaleString()}`,
      '',
      comment.message
    ];

    if (comment.replies && comment.replies.length > 0) {
      lines.push('', '--- Replies ---');
      for (const reply of comment.replies) {
        lines.push(`${reply.author}: ${reply.message}`);
      }
    }

    return lines.join('\n');
  }
}
