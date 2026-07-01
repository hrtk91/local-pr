/**
 * Comment Store - JSONL+gzip persistence (File-based Repository)
 *
 * ファイル単位でコメントを管理。セッション概念なし。
 * 形式: ~/.local-review/<project-hash>/files/{encodedPath}.jsonl.gz
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import * as os from 'os';
import { execSync } from 'child_process';
import { ReviewComment } from './types';

// ============================================================
// State
// ============================================================

let workspacePath: string | undefined;
let storageDir: string | undefined;
let isSaving = false;

// ============================================================
// Project Hash
// ============================================================

/**
 * プロジェクトのハッシュを計算する。
 * git remote get-url origin のSHA256先頭12文字。
 * remote がなければワークスペースの絶対パスのSHA256先頭12文字。
 */
function computeProjectHash(wsPath: string): string {
  let source: string;
  try {
    source = execSync('git remote get-url origin', {
      cwd: wsPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    source = path.resolve(wsPath);
  }
  return crypto.createHash('sha256').update(source).digest('hex').substring(0, 12);
}

// ============================================================
// Initialization
// ============================================================

export function init(wsPath: string, storageBaseDir?: string) {
  workspacePath = wsPath;
  const baseDir = storageBaseDir || os.homedir();
  const hash = computeProjectHash(wsPath);
  storageDir = path.join(baseDir, '.local-review', hash);
  ensureReviewDir();
  migrateFromOldStorage(wsPath);
}

export function getWorkspacePath(): string | undefined {
  return workspacePath;
}

export function getStorageDir(): string | undefined {
  return storageDir;
}

export function getIsSaving(): boolean {
  return isSaving;
}

// ============================================================
// Path Helpers
// ============================================================

function getReviewDir(): string {
  if (!storageDir) throw new Error('Store not initialized');
  return storageDir;
}

function getFilesDir(): string {
  return path.join(getReviewDir(), 'files');
}

/**
 * ファイルパスをURLエンコードして .jsonl.gz パスを返す
 * 例: src/App.tsx → ~/.local-review/<hash>/files/src%2FApp.tsx.jsonl.gz
 */
export function getCommentsPath(targetFile: string): string {
  const encoded = encodeURIComponent(targetFile.replace(/\\/g, '/'));
  return path.join(getFilesDir(), `${encoded}.jsonl.gz`);
}

/**
 * .jsonl.gz パスから元のファイルパスをデコード
 */
export function decodeFilePath(jsonlPath: string): string {
  const basename = path.basename(jsonlPath, '.jsonl.gz');
  return decodeURIComponent(basename);
}

function ensureReviewDir() {
  const filesDir = getFilesDir();
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
  }
}

// ============================================================
// Migration from old .review/ storage
// ============================================================

function migrateFromOldStorage(wsPath: string) {
  const oldFilesDir = path.join(wsPath, '.review', 'files');
  if (!fs.existsSync(oldFilesDir)) return;

  const newFilesDir = getFilesDir();
  const oldFiles = fs.readdirSync(oldFilesDir).filter(f => f.endsWith('.jsonl.gz'));
  if (oldFiles.length === 0) return;

  // Only migrate if new location is empty
  const newFiles = fs.existsSync(newFilesDir)
    ? fs.readdirSync(newFilesDir).filter(f => f.endsWith('.jsonl.gz'))
    : [];
  if (newFiles.length > 0) return;

  console.log(`[Local Review] Migrating ${oldFiles.length} comment files from .review/ to ${newFilesDir}`);
  for (const file of oldFiles) {
    const src = path.join(oldFilesDir, file);
    const dst = path.join(newFilesDir, file);
    fs.copyFileSync(src, dst);
  }
  console.log('[Local Review] Migration complete');
}

// ============================================================
// JSONL+gzip Operations
// ============================================================

function readJsonlGzip(filePath: string): ReviewComment[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const compressed = fs.readFileSync(filePath);
    const content = zlib.gunzipSync(compressed).toString('utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ReviewComment);
  } catch (e) {
    console.error('Failed to read JSONL.gz:', e);
    return [];
  }
}

function writeJsonlGzip(filePath: string, comments: ReviewComment[]) {
  const content = comments.map(c => JSON.stringify(c)).join('\n');
  const compressed = zlib.gzipSync(content);

  // ディレクトリ確認
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, compressed);
}

// ============================================================
// CRUD Operations
// ============================================================

/**
 * ファイルの全コメントを読み込み
 */
export function load(targetFile: string): ReviewComment[] {
  const commentsPath = getCommentsPath(targetFile);
  return readJsonlGzip(commentsPath);
}

/**
 * activeなコメントのみ読み込み（resolved/outdated を除外）
 */
export function loadActive(targetFile: string): ReviewComment[] {
  const all = load(targetFile);
  return all.filter(c => !c.resolved && !c.outdated);
}

/**
 * ファイルの全コメントを保存
 */
export function save(targetFile: string, comments: ReviewComment[]) {
  const commentsPath = getCommentsPath(targetFile);
  isSaving = true;
  writeJsonlGzip(commentsPath, comments);
  setTimeout(() => { isSaving = false; }, 200);
}

/**
 * コメントを検索
 */
export function findById(targetFile: string, commentId: string): ReviewComment | undefined {
  const comments = load(targetFile);
  return comments.find(c => c.id === commentId);
}

/**
 * 新しいコメントを作成
 */
export function create(targetFile: string, comment: Omit<ReviewComment, 'id' | 'created_at'>): ReviewComment {
  const comments = load(targetFile);
  const maxId = comments.reduce((max, c) => Math.max(max, parseInt(c.id) || 0), 0);
  const newComment: ReviewComment = {
    ...comment,
    id: (maxId + 1).toString(),
    created_at: new Date().toISOString()
  };
  comments.push(newComment);
  save(targetFile, comments);
  return newComment;
}

/**
 * コメントを更新
 */
export function update(
  targetFile: string,
  commentId: string,
  updates: Partial<ReviewComment>
): ReviewComment | undefined {
  const comments = load(targetFile);
  const comment = comments.find(c => c.id === commentId);
  if (!comment) return undefined;
  Object.assign(comment, updates);
  save(targetFile, comments);
  return comment;
}

/**
 * コメントを削除
 */
export function remove(targetFile: string, commentId: string): boolean {
  const comments = load(targetFile);
  const initialLength = comments.length;
  const filtered = comments.filter(c => c.id !== commentId);
  if (filtered.length === initialLength) return false;
  save(targetFile, filtered);
  return true;
}

/**
 * コメントにリプライを追加
 */
export function addReply(
  targetFile: string,
  commentId: string,
  author: string,
  message: string
): boolean {
  const comments = load(targetFile);
  const comment = comments.find(c => c.id === commentId);
  if (!comment) return false;

  if (!comment.replies) {
    comment.replies = [];
  }
  comment.replies.push({
    author,
    message,
    timestamp: new Date().toISOString()
  });

  save(targetFile, comments);
  return true;
}

// ============================================================
// Helpers
// ============================================================

/**
 * 指定行の内容を取得
 */
export function getLineContent(file: string, line: number): string {
  if (!workspacePath) return '';
  const filePath = path.join(workspacePath, file);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = line - 1;
    if (lineIndex >= 0 && lineIndex < lines.length) {
      return lines[lineIndex];
    }
  } catch (e) {
    // Ignore
  }
  return '';
}

/**
 * コメントが outdated かどうかを判定
 */
export function isOutdated(comment: ReviewComment): boolean {
  if (!workspacePath) return false;

  const filePath = path.join(workspacePath, comment.file);
  if (!fs.existsSync(filePath)) return true;
  if (!comment.line_content) return false;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = comment.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) return true;

    const currentLine = lines[lineIndex].trim();
    const savedLine = comment.line_content.trim();
    return currentLine !== savedLine;
  } catch (e) {
    return true;
  }
}

// ============================================================
// File Discovery
// ============================================================

/**
 * レビューコメントがある全ファイルを取得
 */
export function getAllReviewedFiles(): string[] {
  const filesDir = getFilesDir();
  if (!fs.existsSync(filesDir)) return [];

  return fs.readdirSync(filesDir)
    .filter(f => f.endsWith('.jsonl.gz'))
    .map(f => decodeFilePath(f));
}

/**
 * 全ファイルのactiveなコメント数を取得
 */
export function getActiveCommentCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of getAllReviewedFiles()) {
    const active = loadActive(file);
    if (active.length > 0) {
      counts.set(file, active.length);
    }
  }
  return counts;
}
