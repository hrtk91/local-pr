/**
 * TreeBuilder - Pure tree construction logic for changed files.
 *
 * No VSCode dependency. Testable with plain objects.
 */

import * as path from 'path';
import { ChangedFile } from './gitService';

// ============================================================
// Types
// ============================================================

export type TreeNode = DirNode | FileNode;

export type DirNode = {
  kind: 'dir';
  name: string;
  dirPath: string;
  children: TreeNode[];
};

export type FileNode = {
  kind: 'file';
  file: ChangedFile;
};

// ============================================================
// Build Tree
// ============================================================

export function buildFileTree(files: ChangedFile[]): TreeNode[] {
  const root: Map<string, TreeNode> = new Map();
  const dirMap = new Map<string, DirNode>();

  const getOrCreateDir = (dirPath: string): DirNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;

    const dir: DirNode = {
      kind: 'dir',
      name: path.basename(dirPath),
      dirPath,
      children: [],
    };
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
    const node: FileNode = { kind: 'file', file };
    const dirPath = path.dirname(file.path);

    if (dirPath === '.' || dirPath === '') {
      root.set(file.path, node);
    } else {
      const dir = getOrCreateDir(dirPath);
      dir.children.push(node);
    }
  }

  return collapseSingleChildDirs([...root.values()]);
}

// ============================================================
// Collapse single-child directories
// ============================================================

export function collapseSingleChildDirs(nodes: TreeNode[]): TreeNode[] {
  return nodes.map(node => {
    if (node.kind !== 'dir') return node;

    node.children = collapseSingleChildDirs(node.children);

    if (node.children.length === 1 && node.children[0].kind === 'dir') {
      const child = node.children[0];
      return {
        kind: 'dir' as const,
        name: `${node.name}/${child.name}`,
        dirPath: child.dirPath,
        children: child.children,
      };
    }
    return node;
  });
}
