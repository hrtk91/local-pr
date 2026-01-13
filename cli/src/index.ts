#!/usr/bin/env node
/**
 * Local PR Review CLI
 * コメントの作成・読み取り・更新を行うCLIツール
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ============================================================
// Types
// ============================================================

type ReviewComment = {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  line_content: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  title?: string;
  resolved?: boolean;
  outdated?: boolean;
  created_at: string;
  author?: 'claude' | 'user';
  replies?: Array<{ author: string; message: string; timestamp: string }>;
};

// ============================================================
// File Operations
// ============================================================

function getCommentsPath(targetFile: string): string {
  const encoded = encodeURIComponent(targetFile.replace(/\\/g, '/'));
  return path.join('.review', 'files', `${encoded}.jsonl.gz`);
}

function readComments(targetFile: string): ReviewComment[] {
  const filePath = getCommentsPath(targetFile);
  try {
    if (!fs.existsSync(filePath)) return [];
    const compressed = fs.readFileSync(filePath);
    const content = zlib.gunzipSync(compressed).toString('utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ReviewComment);
  } catch {
    return [];
  }
}

function writeComments(targetFile: string, comments: ReviewComment[]) {
  const filePath = getCommentsPath(targetFile);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = comments.map(c => JSON.stringify(c)).join('\n');
  const compressed = zlib.gzipSync(content);
  fs.writeFileSync(filePath, compressed);
}

function getLineContent(file: string, line: number): string {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    return lines[line - 1] || '';
  } catch {
    return '';
  }
}

function getAllReviewedFiles(): string[] {
  const filesDir = path.join('.review', 'files');
  if (!fs.existsSync(filesDir)) return [];
  return fs.readdirSync(filesDir)
    .filter(f => f.endsWith('.jsonl.gz'))
    .map(f => decodeURIComponent(path.basename(f, '.jsonl.gz')));
}

// ============================================================
// Commands
// ============================================================

function cmdAdd(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1];
  }

  const { file, line, message, severity = 'info', title, 'end-line': endLine } = opts;
  if (!file || !line || !message) {
    console.error('Usage: add --file <path> --line <num> --message <text> [--severity error|warning|info] [--title <text>] [--end-line <num>]');
    process.exit(1);
  }

  // Validate severity
  const validSeverities = ['error', 'warning', 'info'];
  if (!validSeverities.includes(severity)) {
    console.error(`Invalid severity: ${severity}. Must be one of: ${validSeverities.join(', ')}`);
    process.exit(1);
  }

  const comments = readComments(file);
  const maxId = comments.reduce((max, c) => Math.max(max, parseInt(c.id) || 0), 0);

  const newComment: ReviewComment = {
    id: (maxId + 1).toString(),
    file,
    line: parseInt(line),
    line_content: getLineContent(file, parseInt(line)),
    message,
    severity: severity as 'error' | 'warning' | 'info',
    author: 'claude',
    created_at: new Date().toISOString(),
  };

  if (title) newComment.title = title;
  if (endLine) newComment.endLine = parseInt(endLine);

  comments.push(newComment);
  writeComments(file, comments);
  console.log(`Created comment #${newComment.id} on ${file}:${line}`);
}

function cmdList(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) {
      opts[args[i].replace(/^--/, '')] = args[i + 1] || 'true';
    }
  }

  const { file, active, format = 'text' } = opts;

  if (file) {
    // 特定ファイルのコメント
    let comments = readComments(file);
    if (active === 'true') {
      comments = comments.filter(c => !c.resolved && !c.outdated);
    }
    if (format === 'json') {
      console.log(JSON.stringify(comments, null, 2));
    } else {
      printComments(file, comments);
    }
  } else {
    // 全ファイル
    const files = getAllReviewedFiles();
    const allComments: { file: string; comments: ReviewComment[] }[] = [];

    for (const f of files) {
      let comments = readComments(f);
      if (active === 'true') {
        comments = comments.filter(c => !c.resolved && !c.outdated);
      }
      if (comments.length > 0) {
        allComments.push({ file: f, comments });
      }
    }

    if (format === 'json') {
      console.log(JSON.stringify(allComments, null, 2));
    } else {
      for (const { file: f, comments } of allComments) {
        printComments(f, comments);
      }
    }
  }
}

function printComments(file: string, comments: ReviewComment[]) {
  if (comments.length === 0) return;
  console.log(`\n=== ${file} (${comments.length} comments) ===`);
  for (const c of comments) {
    const status = c.resolved ? '[RESOLVED]' : c.outdated ? '[OUTDATED]' : '';
    const icon = c.severity === 'error' ? '🔴' : c.severity === 'warning' ? '🟡' : '🟢';
    console.log(`  #${c.id} ${icon} L${c.line}${c.endLine ? `-${c.endLine}` : ''} ${status}`);
    if (c.title) console.log(`     ${c.title}`);
    console.log(`     ${c.message.split('\n')[0]}${c.message.includes('\n') ? '...' : ''}`);
    if (c.replies?.length) {
      console.log(`     💬 ${c.replies.length} replies`);
    }
  }
}

function cmdResolve(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    opts[args[i].replace(/^--/, '')] = args[i + 1];
  }

  const { file, id } = opts;
  if (!file || !id) {
    console.error('Usage: resolve --file <path> --id <num>');
    process.exit(1);
  }

  const comments = readComments(file);
  const comment = comments.find(c => c.id === id);
  if (!comment) {
    console.error(`Comment #${id} not found in ${file}`);
    process.exit(1);
  }

  comment.resolved = true;
  writeComments(file, comments);
  console.log(`Resolved comment #${id} in ${file}`);
}

function cmdReply(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    opts[args[i].replace(/^--/, '')] = args[i + 1];
  }

  const { file, id, message, author = 'claude' } = opts;
  if (!file || !id || !message) {
    console.error('Usage: reply --file <path> --id <num> --message <text> [--author claude|user]');
    process.exit(1);
  }

  const comments = readComments(file);
  const comment = comments.find(c => c.id === id);
  if (!comment) {
    console.error(`Comment #${id} not found in ${file}`);
    process.exit(1);
  }

  if (!comment.replies) comment.replies = [];
  comment.replies.push({
    author,
    message,
    timestamp: new Date().toISOString(),
  });

  writeComments(file, comments);
  console.log(`Added reply to comment #${id} in ${file}`);
}

function cmdDelete(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    opts[args[i].replace(/^--/, '')] = args[i + 1];
  }

  const { file, id } = opts;
  if (!file || !id) {
    console.error('Usage: delete --file <path> --id <num>');
    process.exit(1);
  }

  const comments = readComments(file);
  const filtered = comments.filter(c => c.id !== id);
  if (filtered.length === comments.length) {
    console.error(`Comment #${id} not found in ${file}`);
    process.exit(1);
  }

  writeComments(file, filtered);
  console.log(`Deleted comment #${id} from ${file}`);
}

// ============================================================
// Main
// ============================================================

const [, , command, ...args] = process.argv;

switch (command) {
  case 'add':
    cmdAdd(args);
    break;
  case 'list':
    cmdList(args);
    break;
  case 'resolve':
    cmdResolve(args);
    break;
  case 'reply':
    cmdReply(args);
    break;
  case 'delete':
    cmdDelete(args);
    break;
  default:
    console.log(`Local PR Review CLI

Commands:
  add      Add a new comment
  list     List comments
  resolve  Mark comment as resolved
  reply    Add reply to a comment
  delete   Delete a comment

Examples:
  npx local-pr-cli add --file src/App.tsx --line 42 --message "Add null check" --severity warning
  npx local-pr-cli list --active true
  npx local-pr-cli list --file src/App.tsx --format json
  npx local-pr-cli resolve --file src/App.tsx --id 1
  npx local-pr-cli reply --file src/App.tsx --id 1 --message "Fixed"
  npx local-pr-cli delete --file src/App.tsx --id 1
`);
}
