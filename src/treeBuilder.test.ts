import { describe, it, expect } from 'vitest';
import { buildFileTree, collapseSingleChildDirs, TreeNode, DirNode, FileNode } from './treeBuilder';
import { ChangedFile } from './gitService';

function fileNames(nodes: TreeNode[]): string[] {
  return nodes
    .filter((n): n is FileNode => n.kind === 'file')
    .map(n => n.file.path);
}

function dirNames(nodes: TreeNode[]): string[] {
  return nodes
    .filter((n): n is DirNode => n.kind === 'dir')
    .map(n => n.name);
}

describe('buildFileTree', () => {
  it('should place root-level files at root', () => {
    const files: ChangedFile[] = [
      { status: 'M', path: 'README.md' },
      { status: 'A', path: '.gitignore' },
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    expect(fileNames(tree)).toEqual(['README.md', '.gitignore']);
  });

  it('should group files under directories', () => {
    const files: ChangedFile[] = [
      { status: 'M', path: 'src/index.ts' },
      { status: 'M', path: 'src/utils.ts' },
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('dir');
    const dir = tree[0] as DirNode;
    expect(dir.name).toBe('src');
    expect(fileNames(dir.children)).toEqual(['src/index.ts', 'src/utils.ts']);
  });

  it('should create nested directories', () => {
    const files: ChangedFile[] = [
      { status: 'M', path: 'src/components/Button.tsx' },
    ];
    const tree = buildFileTree(files);

    // src/components should be collapsed into one dir
    expect(tree).toHaveLength(1);
    const dir = tree[0] as DirNode;
    expect(dir.name).toBe('src/components');
    expect(fileNames(dir.children)).toEqual(['src/components/Button.tsx']);
  });

  it('should not collapse directories with multiple children', () => {
    const files: ChangedFile[] = [
      { status: 'M', path: 'src/components/Button.tsx' },
      { status: 'M', path: 'src/utils/format.ts' },
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    const src = tree[0] as DirNode;
    expect(src.name).toBe('src');
    expect(dirNames(src.children)).toEqual(['components', 'utils']);
  });

  it('should mix files and directories at root', () => {
    const files: ChangedFile[] = [
      { status: 'M', path: 'package.json' },
      { status: 'M', path: 'src/index.ts' },
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    const kinds = tree.map(n => n.kind);
    expect(kinds).toContain('file');
    expect(kinds).toContain('dir');
  });

  it('should handle deeply nested paths with collapse', () => {
    const files: ChangedFile[] = [
      { status: 'A', path: 'a/b/c/d/file.ts' },
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    const dir = tree[0] as DirNode;
    expect(dir.name).toBe('a/b/c/d');
    expect(fileNames(dir.children)).toEqual(['a/b/c/d/file.ts']);
  });

  it('should handle empty input', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('should preserve file status in tree', () => {
    const files: ChangedFile[] = [
      { status: 'A', path: 'new.ts' },
      { status: 'D', path: 'old.ts' },
      { status: 'R', path: 'renamed.ts', oldPath: 'original.ts' },
    ];
    const tree = buildFileTree(files);

    const fileNodes = tree.filter((n): n is FileNode => n.kind === 'file');
    expect(fileNodes[0].file.status).toBe('A');
    expect(fileNodes[1].file.status).toBe('D');
    expect(fileNodes[2].file.status).toBe('R');
    expect(fileNodes[2].file.oldPath).toBe('original.ts');
  });

  it('should handle sibling files in same deep directory', () => {
    const files: ChangedFile[] = [
      { status: 'M', path: 'src/api/v1/handler.ts' },
      { status: 'M', path: 'src/api/v1/router.ts' },
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    const dir = tree[0] as DirNode;
    expect(dir.name).toBe('src/api/v1');
    expect(dir.children).toHaveLength(2);
  });
});

describe('collapseSingleChildDirs', () => {
  it('should merge single-child dir chains', () => {
    const input: TreeNode[] = [{
      kind: 'dir', name: 'a', dirPath: 'a',
      children: [{
        kind: 'dir', name: 'b', dirPath: 'a/b',
        children: [{ kind: 'file', file: { status: 'M', path: 'a/b/f.ts' } }],
      }],
    }];

    const result = collapseSingleChildDirs(input);
    expect(result).toHaveLength(1);
    expect((result[0] as DirNode).name).toBe('a/b');
  });

  it('should not merge dirs with multiple children', () => {
    const input: TreeNode[] = [{
      kind: 'dir', name: 'src', dirPath: 'src',
      children: [
        { kind: 'file', file: { status: 'M', path: 'src/a.ts' } },
        { kind: 'file', file: { status: 'M', path: 'src/b.ts' } },
      ],
    }];

    const result = collapseSingleChildDirs(input);
    expect((result[0] as DirNode).name).toBe('src');
    expect((result[0] as DirNode).children).toHaveLength(2);
  });

  it('should not merge dir with single file child', () => {
    const input: TreeNode[] = [{
      kind: 'dir', name: 'src', dirPath: 'src',
      children: [
        { kind: 'file', file: { status: 'M', path: 'src/index.ts' } },
      ],
    }];

    const result = collapseSingleChildDirs(input);
    expect((result[0] as DirNode).name).toBe('src');
  });

  it('should handle triple-deep collapse', () => {
    const input: TreeNode[] = [{
      kind: 'dir', name: 'a', dirPath: 'a',
      children: [{
        kind: 'dir', name: 'b', dirPath: 'a/b',
        children: [{
          kind: 'dir', name: 'c', dirPath: 'a/b/c',
          children: [{ kind: 'file', file: { status: 'M', path: 'a/b/c/f.ts' } }],
        }],
      }],
    }];

    const result = collapseSingleChildDirs(input);
    expect((result[0] as DirNode).name).toBe('a/b/c');
  });
});
