/**
 * gitService.test.ts - Unit tests for git service parsing logic.
 *
 * Tests parseNameStatus() which converts `git diff --name-status` output
 * into structured ChangedFile objects. No actual git commands are executed.
 */

import { describe, it, expect } from 'vitest';
import { parseNameStatus } from './gitService';

// ============================================================
// parseNameStatus Tests
// ============================================================

describe('parseNameStatus', () => {
  it('should parse modified file', () => {
    const output = 'M\tsrc/api/handler.ts';
    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      status: 'M',
      path: 'src/api/handler.ts',
    });
  });

  it('should parse added file', () => {
    const output = 'A\tsrc/components/NewForm.tsx';
    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      status: 'A',
      path: 'src/components/NewForm.tsx',
    });
  });

  it('should parse deleted file', () => {
    const output = 'D\tsrc/old/legacy.ts';
    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      status: 'D',
      path: 'src/old/legacy.ts',
    });
  });

  it('should parse renamed file with R100 status', () => {
    const output = 'R100\tsrc/old/name.ts\tsrc/new/name.ts';
    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      status: 'R',
      path: 'src/new/name.ts',
      oldPath: 'src/old/name.ts',
    });
  });

  it('should parse renamed file with partial similarity (R075)', () => {
    const output = 'R075\tsrc/utils/old.ts\tsrc/utils/new.ts';
    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      status: 'R',
      path: 'src/utils/new.ts',
      oldPath: 'src/utils/old.ts',
    });
  });

  it('should parse multiple files', () => {
    const output = [
      'M\tsrc/api/handler.ts',
      'A\tsrc/components/NewForm.tsx',
      'D\tsrc/old/legacy.ts',
      'R100\tsrc/old/name.ts\tsrc/new/name.ts',
    ].join('\n');

    const result = parseNameStatus(output);

    expect(result).toHaveLength(4);
    // Sorted by path: handler.ts < legacy.ts < name.ts (new) < NewForm.tsx
    expect(result.map((f) => f.path)).toEqual([
      'src/api/handler.ts',
      'src/components/NewForm.tsx',
      'src/new/name.ts',
      'src/old/legacy.ts',
    ]);
    expect(result.map((f) => f.status)).toEqual(['M', 'A', 'R', 'D']);
  });

  it('should sort results alphabetically by path', () => {
    const output = [
      'M\tsrc/zoo.ts',
      'A\tsrc/alpha.ts',
      'M\tsrc/middle.ts',
    ].join('\n');

    const result = parseNameStatus(output);

    expect(result).toHaveLength(3);
    expect(result[0].path).toBe('src/alpha.ts');
    expect(result[1].path).toBe('src/middle.ts');
    expect(result[2].path).toBe('src/zoo.ts');
  });

  it('should return empty array for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });

  it('should return empty array for whitespace-only output', () => {
    expect(parseNameStatus('   \n  \n  ')).toEqual([]);
  });

  it('should skip malformed lines without tabs', () => {
    const output = [
      'M\tsrc/valid.ts',
      'this is garbage',
      'A\tsrc/also-valid.ts',
    ].join('\n');

    const result = parseNameStatus(output);

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('src/also-valid.ts');
    expect(result[1].path).toBe('src/valid.ts');
  });

  it('should skip lines with unknown status codes', () => {
    const output = [
      'M\tsrc/valid.ts',
      'X\tsrc/unknown-status.ts',
      'C100\tsrc/copy-source.ts\tsrc/copy-dest.ts',
    ].join('\n');

    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/valid.ts');
  });

  it('should skip rename lines missing the new path', () => {
    // R100 with only one path (malformed)
    const output = 'R100\tsrc/only-old-path.ts';
    const result = parseNameStatus(output);

    expect(result).toEqual([]);
  });

  it('should handle blank lines in output', () => {
    const output = [
      '',
      'M\tsrc/file1.ts',
      '',
      'A\tsrc/file2.ts',
      '',
    ].join('\n');

    const result = parseNameStatus(output);

    expect(result).toHaveLength(2);
  });

  it('should handle paths with spaces', () => {
    const output = 'M\tsrc/my file.ts';
    const result = parseNameStatus(output);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/my file.ts');
  });

  it('should not include oldPath for non-rename statuses', () => {
    const output = 'M\tsrc/modified.ts';
    const result = parseNameStatus(output);

    expect(result[0].oldPath).toBeUndefined();
  });
});
