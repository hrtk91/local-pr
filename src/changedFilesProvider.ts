/**
 * ChangedFilesProvider - TreeDataProvider for sidebar showing changed files from git diff.
 *
 * Supports two view modes (like VSCode Source Control):
 *   - tree: files grouped by directory hierarchy
 *   - flat: simple file list
 *
 * Uses FileDecorationProvider for status badges (M/A/D/R with git colors),
 * and resourceUri for file-type icons from the user's icon theme.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  getChangedFiles,
  getFileContentAtCommit,
  detectBaseBranch,
  ChangedFile,
  FileStatus,
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
// FileDecorationProvider - status badge on files (M/A/D/R)
// ============================================================

const STATUS_COLORS: Record<FileStatus, vscode.ThemeColor> = {
  M: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
  A: new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
  D: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
  R: new vscode.ThemeColor('gitDecoration.renamedResourceForeground'),
};

export class ChangedFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private decorations = new Map<string, vscode.FileDecoration>();

  update(files: ChangedFile[], workspacePath: string): void {
    this.decorations.clear();
    for (const file of files) {
      const uri = vscode.Uri.file(path.join(workspacePath, file.path));
      this.decorations.set(uri.toString(), {
        badge: file.status,
        color: STATUS_COLORS[file.status],
        tooltip: `${file.status === 'M' ? 'Modified' : file.status === 'A' ? 'Added' : file.status === 'D' ? 'Deleted' : 'Renamed'}`,
      });
    }
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return this.decorations.get(uri.toString());
  }
}

// ============================================================
// Tree Item Types
// ============================================================

type TreeElement = RangeHeaderItem | DirItem | FileItem;

class RangeHeaderItem extends vscode.TreeItem {
  readonly kind = 'header' as const;

  constructor(base: string, target: string) {
    const shortBase = base.length > 16 ? base.substring(0, 8) + '…' : base;
    super(`${shortBase}  →  ${target}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('git-compare');
    this.contextValue = 'rangeHeader';
  }
}

class DirItem extends vscode.TreeItem {
  readonly kind = 'dir' as const;
  readonly dirPath: string;
  readonly children: TreeElement[] = [];

  constructor(dirName: string, dirPath: string) {
    super(dirName, vscode.TreeItemCollapsibleState.Expanded);
    this.dirPath = dirPath;
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

    this.tooltip = `${file.status} ${file.path}`;
    this.contextValue = 'changedFile';
    this.resourceUri = vscode.Uri.file(path.join(workspacePath, file.path));
    this.command = this.buildDiffCommand();
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
  private decorationProvider: ChangedFileDecorationProvider | undefined;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.baseRef = detectBaseBranch(workspacePath);
    this.targetRef = 'HEAD';
  }

  setDecorationProvider(provider: ChangedFileDecorationProvider): void {
    this.decorationProvider = provider;
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
      const header = new RangeHeaderItem(this.baseRef, this.targetRef);
      try {
        const files = getChangedFiles(this.workspacePath, this.baseRef, this.targetRef);
        this.decorationProvider?.update(files, this.workspacePath);

        if (this.viewMode === 'flat') {
          return [header, ...files.map(f => new FileItem(f, this.workspacePath, this.baseRef))];
        }
        return [header, ...this.buildTree(files)];
      } catch (err) {
        console.error('[Local Review] Failed to get changed files:', err);
        return [header];
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
