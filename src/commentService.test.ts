/**
 * commentService.test.ts - Service層のテスト
 *
 * MockUIAdapterを使用してビジネスロジックをテスト。
 * VSCode API依存なしでテスト可能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as service from './commentService';
import * as store from './commentStore';
import { createMockUIAdapter } from './uiAdapter';

// ============================================================
// Test Helpers
// ============================================================

let testDir: string;
let mockUI: ReturnType<typeof createMockUIAdapter>;

function createTestDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-service-test-'));
  return dir;
}

function cleanupTestDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// Setup / Teardown
// ============================================================

beforeEach(() => {
  testDir = createTestDir();
  mockUI = createMockUIAdapter();
  service.init(mockUI, testDir);
});

afterEach(() => {
  cleanupTestDir(testDir);
});

// ============================================================
// addComment Tests
// ============================================================

describe('addComment', () => {
  it('should create comment in store and UI thread', () => {
    const comment = service.addComment('src/App.tsx', 10, 'Test message', {
      author: 'user',
      title: 'Test Title'
    });

    // Store確認
    expect(comment).toBeDefined();
    expect(comment!.id).toBe('1');
    expect(comment!.message).toBe('Test message');
    expect(comment!.author).toBe('user');

    // UI確認
    expect(mockUI.threads.size).toBe(1);
    const thread = mockUI.threads.get('src/App.tsx:1');
    expect(thread).toBeDefined();
    expect(thread!.author).toBe('user');
  });

  it('should create thread with claude author by default', () => {
    const comment = service.addComment('src/App.tsx', 10, 'Claude review');

    expect(comment!.author).toBe('claude');
    const thread = mockUI.threads.get('src/App.tsx:1');
    expect(thread!.author).toBe('claude');
  });

  it('should auto-increment IDs', () => {
    service.addComment('src/App.tsx', 10, 'First');
    service.addComment('src/App.tsx', 20, 'Second');
    const third = service.addComment('src/App.tsx', 30, 'Third');

    expect(third!.id).toBe('3');
    expect(mockUI.threads.size).toBe(3);
  });
});

// ============================================================
// addReply Tests - CRITICAL
// ============================================================

describe('addReply - CRITICAL for regression prevention', () => {
  it('should add reply to existing comment', () => {
    const comment = service.addComment('src/App.tsx', 10, 'Original', { author: 'claude' });

    const success = service.addReply('src/App.tsx', comment!.id, 'user', 'Reply text');

    expect(success).toBe(true);

    // Store確認
    const loaded = store.load('src/App.tsx');
    expect(loaded[0].replies).toHaveLength(1);
    expect(loaded[0].replies![0].author).toBe('user');
    expect(loaded[0].replies![0].message).toBe('Reply text');
  });

  it('should NOT overwrite original comment message', () => {
    const originalMessage = 'Original message - DO NOT OVERWRITE';
    const comment = service.addComment('src/App.tsx', 10, originalMessage, { author: 'claude' });

    service.addReply('src/App.tsx', comment!.id, 'user', 'Reply text');

    const loaded = store.load('src/App.tsx');
    expect(loaded[0].message).toBe(originalMessage);
  });

  it('should NOT change original comment title', () => {
    const comment = service.addComment('src/App.tsx', 10, 'msg', {
      author: 'claude',
      title: 'Original Title'
    });

    service.addReply('src/App.tsx', comment!.id, 'user', 'Reply');

    const loaded = store.load('src/App.tsx');
    expect(loaded[0].title).toBe('Original Title');
  });

  it('should NOT change original comment line', () => {
    const comment = service.addComment('src/App.tsx', 42, 'msg', { author: 'claude' });

    service.addReply('src/App.tsx', comment!.id, 'user', 'Reply');

    const loaded = store.load('src/App.tsx');
    expect(loaded[0].line).toBe(42);
  });

  it('should NOT change original comment severity', () => {
    const comment = service.addComment('src/App.tsx', 10, 'msg', {
      author: 'claude',
      severity: 'error'
    });

    service.addReply('src/App.tsx', comment!.id, 'user', 'Reply');

    const loaded = store.load('src/App.tsx');
    expect(loaded[0].severity).toBe('error');
  });

  it('should preserve author after UI refresh', () => {
    // User creates a comment
    const comment = service.addComment('src/App.tsx', 10, 'User message', { author: 'user' });

    // Clear mock to track new thread creation
    mockUI.threads.clear();

    // Add reply (triggers UI refresh)
    service.addReply('src/App.tsx', comment!.id, 'claude', 'Claude reply');

    // UI should recreate thread with correct author from store
    const thread = mockUI.threads.get('src/App.tsx:1');
    expect(thread).toBeDefined();
    expect(thread!.author).toBe('user'); // Should preserve original author!
  });

  it('should support multiple replies', () => {
    const comment = service.addComment('src/App.tsx', 10, 'Original', { author: 'claude' });

    service.addReply('src/App.tsx', comment!.id, 'user', 'First reply');
    service.addReply('src/App.tsx', comment!.id, 'claude', 'Second reply');
    service.addReply('src/App.tsx', comment!.id, 'user', 'Third reply');

    const loaded = store.load('src/App.tsx');
    expect(loaded[0].replies).toHaveLength(3);
    expect(loaded[0].replies![0].message).toBe('First reply');
    expect(loaded[0].replies![1].message).toBe('Second reply');
    expect(loaded[0].replies![2].message).toBe('Third reply');
  });

  it('should return false for non-existent comment', () => {
    service.addComment('src/App.tsx', 10, 'msg', { author: 'claude' });

    const success = service.addReply('src/App.tsx', 'nonexistent-id', 'user', 'Reply');

    expect(success).toBe(false);
  });
});

// ============================================================
// removeComment Tests
// ============================================================

describe('removeComment', () => {
  it('should remove comment from store and UI', () => {
    const comment = service.addComment('src/App.tsx', 10, 'msg', { author: 'claude' });

    const success = service.removeComment('src/App.tsx', comment!.id);

    expect(success).toBe(true);
    expect(store.load('src/App.tsx')).toHaveLength(0);
    expect(mockUI.threads.size).toBe(0);
  });

  it('should return false for non-existent comment', () => {
    service.addComment('src/App.tsx', 10, 'msg', { author: 'claude' });

    const success = service.removeComment('src/App.tsx', 'nonexistent');

    expect(success).toBe(false);
  });
});

// ============================================================
// resolveComment Tests
// ============================================================

describe('resolveComment', () => {
  it('should mark comment as resolved and remove from UI', () => {
    const comment = service.addComment('src/App.tsx', 10, 'msg', { author: 'claude' });

    const success = service.resolveComment('src/App.tsx', comment!.id);

    expect(success).toBe(true);

    // Store should have resolved flag
    const loaded = store.load('src/App.tsx');
    expect(loaded[0].resolved).toBe(true);

    // UI should remove thread
    expect(mockUI.threads.size).toBe(0);
  });

  it('should NOT show resolved comments after loadFileComments', () => {
    const comment = service.addComment('src/App.tsx', 10, 'msg', { author: 'claude' });
    service.resolveComment('src/App.tsx', comment!.id);

    // Reload file comments
    service.loadFileComments('src/App.tsx');

    // Resolved comment should NOT appear in UI
    expect(mockUI.threads.size).toBe(0);
  });

  it('should NOT show resolved comments after loadAllActiveComments', () => {
    const comment = service.addComment('src/App.tsx', 10, 'msg', { author: 'claude' });
    service.resolveComment('src/App.tsx', comment!.id);

    // Reload all comments
    service.loadAllActiveComments();

    // Resolved comment should NOT appear in UI
    expect(mockUI.threads.size).toBe(0);
  });
});

// ============================================================
// loadFileComments Tests
// ============================================================

describe('loadFileComments', () => {
  it('should load comments from store to UI', () => {
    // Add comments directly to store
    store.create('src/App.tsx', {
      file: 'src/App.tsx',
      line: 10,
      line_content: '',
      message: 'Comment 1',
      severity: 'info',
      author: 'claude'
    });
    store.create('src/App.tsx', {
      file: 'src/App.tsx',
      line: 20,
      line_content: '',
      message: 'Comment 2',
      severity: 'warning',
      author: 'user'
    });

    // Load via service
    service.loadFileComments('src/App.tsx');

    // UI should have threads
    expect(mockUI.threads.size).toBe(2);
    expect(mockUI.threads.get('src/App.tsx:1')!.author).toBe('claude');
    expect(mockUI.threads.get('src/App.tsx:2')!.author).toBe('user');
  });

  it('should clear existing threads before loading', () => {
    service.addComment('src/App.tsx', 10, 'Old', { author: 'claude' });
    expect(mockUI.threads.size).toBe(1);

    // Add new comment to store without UI
    store.create('src/App.tsx', {
      file: 'src/App.tsx',
      line: 20,
      line_content: '',
      message: 'New',
      severity: 'info',
      author: 'user'
    });

    // Reload should clear and recreate
    service.loadFileComments('src/App.tsx');

    expect(mockUI.threads.size).toBe(2);
  });
});

// ============================================================
// loadAllActiveComments Tests
// ============================================================

describe('loadAllActiveComments', () => {
  it('should load comments from all files', () => {
    store.create('src/App.tsx', {
      file: 'src/App.tsx',
      line: 10,
      line_content: '',
      message: 'App comment',
      severity: 'info',
      author: 'claude'
    });
    store.create('src/utils.ts', {
      file: 'src/utils.ts',
      line: 5,
      line_content: '',
      message: 'Utils comment',
      severity: 'warning',
      author: 'user'
    });

    service.loadAllActiveComments();

    expect(mockUI.threads.size).toBe(2);
  });

  it('should skip resolved comments', () => {
    const comment = store.create('src/App.tsx', {
      file: 'src/App.tsx',
      line: 10,
      line_content: '',
      message: 'Resolved',
      severity: 'info',
      author: 'claude'
    });
    store.update('src/App.tsx', comment.id, { resolved: true });

    service.loadAllActiveComments();

    expect(mockUI.threads.size).toBe(0);
  });
});

// ============================================================
// handleCommentOrReply Tests - CRITICAL (分岐ロジック)
// ============================================================

describe('handleCommentOrReply - CRITICAL branching logic', () => {
  it('should create new comment when existingCommentId is undefined', () => {
    const result = service.handleCommentOrReply({
      file: 'src/App.tsx',
      line: 10,
      text: 'New comment text',
      existingCommentId: undefined
    });

    expect(result.type).toBe('comment');
    expect(result.success).toBe(true);
    expect(result.comment).toBeDefined();
    expect(result.comment!.message).toBe('New comment text');
    expect(result.comment!.author).toBe('user');
  });

  it('should add reply when existingCommentId is provided', () => {
    // First create a comment
    const comment = service.addComment('src/App.tsx', 10, 'Original', { author: 'claude' });

    // Then reply via handleCommentOrReply
    const result = service.handleCommentOrReply({
      file: 'src/App.tsx',
      line: 10,
      text: 'Reply text',
      existingCommentId: comment!.id
    });

    expect(result.type).toBe('reply');
    expect(result.success).toBe(true);

    // Verify reply was added
    const loaded = store.load('src/App.tsx');
    expect(loaded[0].replies).toHaveLength(1);
    expect(loaded[0].replies![0].message).toBe('Reply text');
  });

  it('should return failure for reply to non-existent comment', () => {
    const result = service.handleCommentOrReply({
      file: 'src/App.tsx',
      line: 10,
      text: 'Reply text',
      existingCommentId: 'nonexistent-id'
    });

    expect(result.type).toBe('reply');
    expect(result.success).toBe(false);
  });

  it('should truncate title to 50 chars for new comment', () => {
    const longText = 'A'.repeat(100) + '\nSecond line';
    const result = service.handleCommentOrReply({
      file: 'src/App.tsx',
      line: 10,
      text: longText,
      existingCommentId: undefined
    });

    expect(result.comment!.title).toBe('A'.repeat(50) + '...');
  });
});

// ============================================================
// expandThread Tests
// ============================================================

describe('expandThread', () => {
  it('should call uiAdapter.expandThread with correct threadId', () => {
    const comment = service.addComment('src/App.tsx', 10, 'Test', { author: 'claude' });

    // Should not throw
    expect(() => {
      service.expandThread('src/App.tsx', comment!.id);
    }).not.toThrow();
  });

  it('should handle non-existent thread gracefully', () => {
    // Should not throw even if thread doesn't exist
    expect(() => {
      service.expandThread('src/App.tsx', 'nonexistent-id');
    }).not.toThrow();
  });
});

// ============================================================
// Integration: Full Workflow
// ============================================================

describe('Integration: Full Workflow', () => {
  it('should handle complete comment lifecycle', () => {
    // 1. Claude adds review comment
    const comment = service.addComment('src/App.tsx', 10, 'Please fix this', {
      author: 'claude',
      severity: 'warning',
      title: 'Bug found'
    });

    expect(mockUI.threads.size).toBe(1);
    expect(mockUI.threads.get('src/App.tsx:1')!.author).toBe('claude');

    // 2. User replies
    service.addReply('src/App.tsx', comment!.id, 'user', 'I will fix it');

    // Verify comment not overwritten
    const afterReply = store.load('src/App.tsx')[0];
    expect(afterReply.message).toBe('Please fix this');
    expect(afterReply.title).toBe('Bug found');
    expect(afterReply.author).toBe('claude');
    expect(afterReply.replies).toHaveLength(1);

    // 3. Claude replies back
    service.addReply('src/App.tsx', comment!.id, 'claude', 'Thanks!');

    expect(store.load('src/App.tsx')[0].replies).toHaveLength(2);

    // 4. User resolves
    service.resolveComment('src/App.tsx', comment!.id);

    expect(store.load('src/App.tsx')[0].resolved).toBe(true);
    expect(mockUI.threads.size).toBe(0);
  });
});
