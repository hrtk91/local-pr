/**
 * ChangedFilesProvider - TreeDataProvider for sidebar showing changed files from git diff.
 *
 * Shows a flat list of files changed between base and target refs.
 * Clicking a file opens a diff view (base vs working tree).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  getChangedFiles,
  getFileContentAtCommit,
  detectBaseBranch,
  ChangedFile,
} from './gitService';

// ============================================================
// GitBaseContentProvider - provides file content at a given commit
// ============================================================

export class GitBaseContentProvider implements vscode.TextDocumentContentProvider {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    // URI format: local-review-base:<base-ref>/<file-path>
    const fullPath = uri.path;
    const slashIndex = fullPath.indexOf('/');
    if (slashIndex === -1) {
      return '';
    }

    const commit = fullPath.substring(0, slashIndex);
    const filePath = fullPath.substring(slashIndex + 1);

    const content = getFileContentAtCommit(this.workspacePath, commit, filePath);
    return content ?? '';
  }
}

// ============================================================
// ChangedFileItem - TreeItem for a single changed file
// ============================================================

class ChangedFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: ChangedFile,
    private workspacePath: string,
    private baseRef: string,
  ) {
    const fileName = path.basename(file.path);
    super(fileName, vscode.TreeItemCollapsibleState.None);

    // Description shows relative directory
    const dir = path.dirname(file.path);
    this.description = dir === '.' ? '' : dir;

    // Tooltip
    this.tooltip = `${file.status} ${file.path}`;

    // Icon based on status
    this.iconPath = this.getStatusIcon(file.status);

    // Context value for menus
    this.contextValue = 'changedFile';

    // Command on click -> open diff
    this.command = this.buildDiffCommand();
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'A':
        return new vscode.ThemeIcon('diff-added');
      case 'D':
        return new vscode.ThemeIcon('diff-removed');
      case 'R':
        return new vscode.ThemeIcon('diff-renamed');
      case 'M':
      default:
        return new vscode.ThemeIcon('diff-modified');
    }
  }

  private buildDiffCommand(): vscode.Command | undefined {
    const filePath = this.file.path;

    if (this.file.status === 'D') {
      // Deleted file: show info message
      return {
        command: 'vscode.open',
        title: 'Show Deleted File',
        arguments: [
          vscode.Uri.parse(`local-review-base:${this.baseRef}/${filePath}`),
        ],
      };
    }

    // Base side URI (content from base commit)
    const baseUri = vscode.Uri.parse(`local-review-base:${this.baseRef}/${filePath}`);

    // Target side: working tree file
    const targetUri = vscode.Uri.file(path.join(this.workspacePath, filePath));

    const title = `${filePath} (${this.baseRef} vs working tree)`;

    return {
      command: 'vscode.diff',
      title: 'Show Diff',
      arguments: [baseUri, targetUri, title],
    };
  }
}

// ============================================================
// ChangedFilesProvider - TreeDataProvider
// ============================================================

export class ChangedFilesProvider implements vscode.TreeDataProvider<ChangedFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ChangedFileItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private baseRef: string;
  private targetRef: string;
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.baseRef = detectBaseBranch(workspacePath);
    this.targetRef = 'HEAD';
  }

  // --- Public API ---

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setBaseRef(ref: string): void {
    this.baseRef = ref;
  }

  setTargetRef(ref: string): void {
    this.targetRef = ref;
  }

  getBaseRef(): string {
    return this.baseRef;
  }

  getTargetRef(): string {
    return this.targetRef;
  }

  // --- TreeDataProvider ---

  getTreeItem(element: ChangedFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ChangedFileItem[] {
    if (!this.workspacePath) {
      return [];
    }

    try {
      const files = getChangedFiles(this.workspacePath, this.baseRef, this.targetRef);
      return files.map(file => new ChangedFileItem(file, this.workspacePath, this.baseRef));
    } catch (err) {
      console.error('[Local Review] Failed to get changed files:', err);
      return [];
    }
  }
}
