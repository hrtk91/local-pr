/**
 * commentStore.test.ts - Unit tests for comment persistence
 *
 * デグレ防止のためのテスト。特に addReply がコメントを上書きしないことを厳重にテスト。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as store from './commentStore';

// ============================================================
// Test Helpers
// ============================================================

let testDir: string;

function createTestDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-store-test-'));
  return dir;
}

function cleanupTestDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeComment(overrides: Partial<Parameters<typeof store.create>[1]> = {}) {
  return {
    file: 'src/App.tsx',
    line: 10,
    line_content: 'const App = () => {',
    message: 'Test comment message',
    severity: 'warning' as const,
    title: 'Test Title',
    ...overrides,
  };
}

// ============================================================
// Setup / Teardown
// ============================================================

beforeEach(() => {
  testDir = createTestDir();
  store.init(testDir);
});

afterEach(() => {
  cleanupTestDir(testDir);
});

// ============================================================
// JSONL+gzip Read/Write
// ============================================================

describe('JSONL+gzip persistence', () => {
  it('save() and load() should round-trip comments correctly', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    const loaded = store.load(targetFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(comment.id);
    expect(loaded[0].message).toBe('Test comment message');
    expect(loaded[0].title).toBe('Test Title');
  });

  it('should preserve multiple comments in order', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment({ message: 'First' }));
    store.create(targetFile, makeComment({ message: 'Second' }));
    store.create(targetFile, makeComment({ message: 'Third' }));

    const loaded = store.load(targetFile);
    expect(loaded).toHaveLength(3);
    expect(loaded[0].message).toBe('First');
    expect(loaded[1].message).toBe('Second');
    expect(loaded[2].message).toBe('Third');
  });

  it('should handle Japanese text correctly', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment({
      message: 'これは日本語のコメントです。絵文字も🎉テスト！',
      title: 'テストタイトル',
    }));

    const loaded = store.load(targetFile);
    expect(loaded[0].message).toBe('これは日本語のコメントです。絵文字も🎉テスト！');
    expect(loaded[0].title).toBe('テストタイトル');
  });

  it('should return empty array when file does not exist', () => {
    const loaded = store.load('nonexistent/file.tsx');
    expect(loaded).toEqual([]);
  });
});

// ============================================================
// Path Encoding
// ============================================================

describe('path encoding', () => {
  it('should encode forward slashes in file paths', () => {
    const commentsPath = store.getCommentsPath('src/components/App.tsx');
    expect(commentsPath).toContain('src%2Fcomponents%2FApp.tsx.jsonl.gz');
  });

  it('should convert backslashes to forward slashes', () => {
    const commentsPath = store.getCommentsPath('src\\components\\App.tsx');
    expect(commentsPath).toContain('src%2Fcomponents%2FApp.tsx.jsonl.gz');
  });

  it('should decode file path correctly', () => {
    const encoded = 'src%2Fcomponents%2FApp.tsx.jsonl.gz';
    const decoded = store.decodeFilePath(encoded);
    expect(decoded).toBe('src/components/App.tsx');
  });
});

// ============================================================
// create()
// ============================================================

describe('create()', () => {
  it('should auto-generate ID starting from 1', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());
    expect(comment.id).toBe('1');
  });

  it('should increment ID for subsequent comments', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment());
    store.create(targetFile, makeComment());
    const third = store.create(targetFile, makeComment());
    expect(third.id).toBe('3');
  });

  it('should set created_at timestamp', () => {
    const targetFile = 'src/App.tsx';
    const before = new Date().toISOString();
    const comment = store.create(targetFile, makeComment());
    const after = new Date().toISOString();

    expect(comment.created_at).toBeDefined();
    expect(comment.created_at >= before).toBe(true);
    expect(comment.created_at <= after).toBe(true);
  });

  it('should persist created comment to file', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    // Re-init to clear any in-memory state
    store.init(testDir);
    const loaded = store.load(targetFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(comment.id);
  });
});

// ============================================================
// addReply() - CRITICAL: Prevent regression!
// ============================================================

describe('addReply() - CRITICAL for regression prevention', () => {
  it('should add reply to existing comment', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    const success = store.addReply(targetFile, comment.id, 'user', 'This is a reply');
    expect(success).toBe(true);

    const loaded = store.load(targetFile);
    expect(loaded[0].replies).toHaveLength(1);
    expect(loaded[0].replies![0].author).toBe('user');
    expect(loaded[0].replies![0].message).toBe('This is a reply');
  });

  it('should NOT overwrite original comment message', () => {
    const targetFile = 'src/App.tsx';
    const originalMessage = 'Original comment message - DO NOT OVERWRITE';
    const comment = store.create(targetFile, makeComment({ message: originalMessage }));

    store.addReply(targetFile, comment.id, 'user', 'Reply message');

    const loaded = store.load(targetFile);
    expect(loaded[0].message).toBe(originalMessage);
  });

  it('should NOT overwrite original comment title', () => {
    const targetFile = 'src/App.tsx';
    const originalTitle = 'Original Title';
    const comment = store.create(targetFile, makeComment({ title: originalTitle }));

    store.addReply(targetFile, comment.id, 'user', 'Reply message');

    const loaded = store.load(targetFile);
    expect(loaded[0].title).toBe(originalTitle);
  });

  it('should NOT change line number after reply', () => {
    const targetFile = 'src/App.tsx';
    const originalLine = 42;
    const comment = store.create(targetFile, makeComment({ line: originalLine }));

    store.addReply(targetFile, comment.id, 'user', 'Reply message');

    const loaded = store.load(targetFile);
    expect(loaded[0].line).toBe(originalLine);
  });

  it('should NOT change severity after reply', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment({ severity: 'error' }));

    store.addReply(targetFile, comment.id, 'user', 'Reply message');

    const loaded = store.load(targetFile);
    expect(loaded[0].severity).toBe('error');
  });

  it('should NOT change line_content after reply', () => {
    const targetFile = 'src/App.tsx';
    const originalLineContent = 'const foo = bar;';
    const comment = store.create(targetFile, makeComment({ line_content: originalLineContent }));

    store.addReply(targetFile, comment.id, 'user', 'Reply message');

    const loaded = store.load(targetFile);
    expect(loaded[0].line_content).toBe(originalLineContent);
  });

  it('should support multiple sequential replies', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    store.addReply(targetFile, comment.id, 'user1', 'First reply');
    store.addReply(targetFile, comment.id, 'user2', 'Second reply');
    store.addReply(targetFile, comment.id, 'claude', 'Third reply');

    const loaded = store.load(targetFile);
    expect(loaded[0].replies).toHaveLength(3);
    expect(loaded[0].replies![0].message).toBe('First reply');
    expect(loaded[0].replies![1].message).toBe('Second reply');
    expect(loaded[0].replies![2].message).toBe('Third reply');
  });

  it('should return false for non-existent comment ID', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment());

    const success = store.addReply(targetFile, 'nonexistent-id', 'user', 'Reply');
    expect(success).toBe(false);
  });

  it('should set timestamp on reply', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    const before = new Date().toISOString();
    store.addReply(targetFile, comment.id, 'user', 'Reply');
    const after = new Date().toISOString();

    const loaded = store.load(targetFile);
    const replyTimestamp = loaded[0].replies![0].timestamp;
    expect(replyTimestamp >= before).toBe(true);
    expect(replyTimestamp <= after).toBe(true);
  });

  it('should work even if comment has no replies array initially', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    // Verify initial state has no replies
    const initialLoad = store.load(targetFile);
    expect(initialLoad[0].replies).toBeUndefined();

    // Add reply
    store.addReply(targetFile, comment.id, 'user', 'First reply');

    // Verify reply was added
    const afterReply = store.load(targetFile);
    expect(afterReply[0].replies).toHaveLength(1);
  });
});

// ============================================================
// update()
// ============================================================

describe('update()', () => {
  it('should update comment message', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    store.update(targetFile, comment.id, { message: 'Updated message' });

    const loaded = store.load(targetFile);
    expect(loaded[0].message).toBe('Updated message');
  });

  it('should update resolved status', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    store.update(targetFile, comment.id, { resolved: true });

    const loaded = store.load(targetFile);
    expect(loaded[0].resolved).toBe(true);
  });

  it('should not affect other comments', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment({ message: 'First' }));
    const second = store.create(targetFile, makeComment({ message: 'Second' }));

    store.update(targetFile, second.id, { message: 'Updated Second' });

    const loaded = store.load(targetFile);
    expect(loaded[0].message).toBe('First');
    expect(loaded[1].message).toBe('Updated Second');
  });

  it('should return undefined for non-existent ID', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment());

    const result = store.update(targetFile, 'nonexistent', { message: 'x' });
    expect(result).toBeUndefined();
  });
});

// ============================================================
// remove()
// ============================================================

describe('remove()', () => {
  it('should remove comment by ID', () => {
    const targetFile = 'src/App.tsx';
    const comment = store.create(targetFile, makeComment());

    const success = store.remove(targetFile, comment.id);
    expect(success).toBe(true);

    const loaded = store.load(targetFile);
    expect(loaded).toHaveLength(0);
  });

  it('should not affect other comments', () => {
    const targetFile = 'src/App.tsx';
    const first = store.create(targetFile, makeComment({ message: 'First' }));
    store.create(targetFile, makeComment({ message: 'Second' }));

    store.remove(targetFile, first.id);

    const loaded = store.load(targetFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].message).toBe('Second');
  });

  it('should return false for non-existent ID', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment());

    const success = store.remove(targetFile, 'nonexistent');
    expect(success).toBe(false);
  });
});

// ============================================================
// loadActive()
// ============================================================

describe('loadActive()', () => {
  it('should exclude resolved comments', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment({ message: 'Active' }));
    const resolved = store.create(targetFile, makeComment({ message: 'Resolved' }));
    store.update(targetFile, resolved.id, { resolved: true });

    const active = store.loadActive(targetFile);
    expect(active).toHaveLength(1);
    expect(active[0].message).toBe('Active');
  });

  it('should exclude outdated comments', () => {
    const targetFile = 'src/App.tsx';
    store.create(targetFile, makeComment({ message: 'Active' }));
    const outdated = store.create(targetFile, makeComment({ message: 'Outdated' }));
    store.update(targetFile, outdated.id, { outdated: true });

    const active = store.loadActive(targetFile);
    expect(active).toHaveLength(1);
    expect(active[0].message).toBe('Active');
  });
});

// ============================================================
// getAllReviewedFiles()
// ============================================================

describe('getAllReviewedFiles()', () => {
  it('should return all files with comments', () => {
    store.create('src/App.tsx', makeComment());
    store.create('src/utils/helper.ts', makeComment());
    store.create('src/components/Button.tsx', makeComment());

    const files = store.getAllReviewedFiles();
    expect(files).toHaveLength(3);
    expect(files).toContain('src/App.tsx');
    expect(files).toContain('src/utils/helper.ts');
    expect(files).toContain('src/components/Button.tsx');
  });

  it('should return empty array when no review directory exists', () => {
    // Use a fresh directory without .review
    const emptyDir = createTestDir();
    store.init(emptyDir);

    const files = store.getAllReviewedFiles();
    expect(files).toEqual([]);

    cleanupTestDir(emptyDir);
  });
});
