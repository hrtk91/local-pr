/**
 * ChangedFilesProvider - TreeDataProvider for sidebar showing changed files from git diff.
 *
 * Supports two view modes (like VSCode Source Control):
 *   - tree: files grouped by directory hierarchy
 *   - flat: simple file list
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
    const fullPath = uri.path;
    const slashIndex = fullPath.indexOf('/');
    if (slashIndex === -1) return '';

    const commit = fullPath.substring(0, slashIndex);
    const filePath = fullPath.substring(slashIndex + 1);

    return getFileContentAtCommit(this.workspacePath, commit, filePath) ?? '';
  }
}

// ============================================================
// Tree Item Types
// ============================================================

type TreeElement = DirItem | FileItem;

class DirItem extends vscode.TreeItem {
  readonly kind = 'dir' as const;
  readonly dirPath: string;
  readonly children: TreeElement[] = [];

  constructor(dirName: string, dirPath: string) {
    super(dirName, vscode.TreeItemCollapsibleState.Expanded);
    this.dirPath = dirPath;
    this.iconPath = vscode.ThemeIcon.Folder;
    this.contextValue = 'directory';
  }
}

class FileItem extends vscode.TreeItem {
  readonly kind = 'file' as const;

  constructor(
    public readonly file: ChangedFile,
    private workspacePath: string,
    private baseRef: string,
  ) {
    const fileName = path.basename(file.path);
    super(fileName, vscode.TreeItemCollapsibleState.None);

    this.description = this.getStatusLabel(file.status);
    this.tooltip = `${file.status} ${file.path}`;
    this.iconPath = this.getStatusIcon(file.status);
    this.contextValue = 'changedFile';
    this.resourceUri = vscode.Uri.file(path.join(workspacePath, file.path));
    this.command = this.buildDiffCommand();
  }

  private getStatusLabel(status: string): string {
    switch (status) {
      case 'A': return 'A';
      case 'D': return 'D';
      case 'R': return 'R';
      case 'M': return 'M';
      default: return '';
    }
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'A': return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
      case 'D': return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
      case 'R': return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
      case 'M':
      default: return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }
  }

  private buildDiffCommand(): vscode.Command | undefined {
    const filePath = this.file.path;

    if (this.file.status === 'D') {
      return {
        command: 'vscode.open',
        title: 'Show Deleted File',
        arguments: [
          vscode.Uri.parse(`local-review-base:${this.baseRef}/${filePath}`),
        ],
      };
    }

    const baseUri = vscode.Uri.parse(`local-review-base:${this.baseRef}/${filePath}`);
    const targetUri = vscode.Uri.file(path.join(this.workspacePath, filePath));
    const title = `${filePath} (${this.baseRef.substring(0, 8)} ↔ working tree)`;

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

export class ChangedFilesProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private baseRef: string;
  private targetRef: string;
  private workspacePath: string;
  private viewMode: 'tree' | 'flat' = 'tree';

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.baseRef = detectBaseBranch(workspacePath);
    this.targetRef = 'HEAD';
  }

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

  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'tree' ? 'flat' : 'tree';
    this.refresh();
  }

  getViewMode(): 'tree' | 'flat' {
    return this.viewMode;
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!this.workspacePath) return [];

    if (!element) {
      try {
        const files = getChangedFiles(this.workspacePath, this.baseRef, this.targetRef);
        if (this.viewMode === 'flat') {
          return files.map(f => new FileItem(f, this.workspacePath, this.baseRef));
        }
        return this.buildTree(files);
      } catch (err) {
        console.error('[Local Review] Failed to get changed files:', err);
        return [];
      }
    }

    if (element.kind === 'dir') {
      return element.children;
    }

    return [];
  }

  private buildTree(files: ChangedFile[]): TreeElement[] {
    const root: Map<string, DirItem | FileItem> = new Map();
    const dirMap = new Map<string, DirItem>();

    const getOrCreateDir = (dirPath: string): DirItem => {
      const existing = dirMap.get(dirPath);
      if (existing) return existing;

      const dirName = path.basename(dirPath);
      const dir = new DirItem(dirName, dirPath);
      dirMap.set(dirPath, dir);

      const parentPath = path.dirname(dirPath);
      if (parentPath === '.' || parentPath === '') {
        root.set(dirPath, dir);
      } else {
        const parent = getOrCreateDir(parentPath);
        parent.children.push(dir);
      }

      return dir;
    };

    for (const file of files) {
      const fileItem = new FileItem(file, this.workspacePath, this.baseRef);
      const dirPath = path.dirname(file.path);

      if (dirPath === '.' || dirPath === '') {
        root.set(file.path, fileItem);
      } else {
        const dir = getOrCreateDir(dirPath);
        dir.children.push(fileItem);
      }
    }

    // Collapse single-child directories (src/api/ → src/api)
    const collapse = (items: TreeElement[]): TreeElement[] => {
      return items.map(item => {
        if (item.kind !== 'dir') return item;
        item.children.splice(0, item.children.length, ...collapse(item.children));
        if (item.children.length === 1 && item.children[0].kind === 'dir') {
          const child = item.children[0];
          const merged = new DirItem(
            `${item.label}/${child.label}`,
            child.dirPath,
          );
          merged.children.push(...child.children);
          return merged;
        }
        return item;
      });
    };

    return collapse([...root.values()]);
  }
}
