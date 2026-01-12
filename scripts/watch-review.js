#!/usr/bin/env node
/**
 * Review watcher script (file-based, JSONL+gzip)
 * Watches .review/files/ for changes and outputs notifications
 *
 * Usage: node watch-review.js [reviewDir]
 * Default reviewDir: .review
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const reviewDir = process.argv[2] || path.join(process.cwd(), '.review');
const filesDir = path.join(reviewDir, 'files');

// Store previous state for diff detection per file
const previousStates = new Map();
let filesWatcher = null;

function decodeFilePath(jsonlPath) {
  const basename = path.basename(jsonlPath, '.jsonl.gz');
  return decodeURIComponent(basename);
}

function loadComments(targetFile) {
  const encoded = encodeURIComponent(targetFile.replace(/\\/g, '/'));
  const commentsPath = path.join(filesDir, `${encoded}.jsonl.gz`);
  try {
    if (fs.existsSync(commentsPath)) {
      const compressed = fs.readFileSync(commentsPath);
      const content = zlib.gunzipSync(compressed).toString('utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
  } catch (e) {
    // Ignore errors
  }
  return [];
}

function loadAllComments() {
  const allComments = new Map();
  if (!fs.existsSync(filesDir)) return allComments;

  const files = fs.readdirSync(filesDir).filter(f => f.endsWith('.jsonl.gz'));
  for (const file of files) {
    const targetFile = decodeFilePath(file);
    const comments = loadComments(targetFile);
    allComments.set(targetFile, comments);
  }
  return allComments;
}

function detectChanges(targetFile, oldComments, newComments) {
  const changes = [];

  oldComments = oldComments || [];
  newComments = newComments || [];

  // Check for new/modified comments
  for (const newComment of newComments) {
    const oldComment = oldComments.find(c => c.id === newComment.id);

    if (!oldComment) {
      changes.push({ type: 'new_comment', file: targetFile, comment: newComment });
      continue;
    }

    // Check resolved status change
    if (newComment.resolved && !oldComment.resolved) {
      changes.push({ type: 'resolved', file: targetFile, comment: newComment });
    }

    // Check for new replies
    const oldReplies = oldComment.replies || [];
    const newReplies = newComment.replies || [];

    if (newReplies.length > oldReplies.length) {
      const newReply = newReplies[newReplies.length - 1];
      changes.push({ type: 'reply', file: targetFile, commentId: newComment.id, reply: newReply });
    }

    // Check message edit
    if (newComment.message !== oldComment.message) {
      changes.push({ type: 'edited', file: targetFile, comment: newComment, oldMessage: oldComment.message });
    }

    // Check outdated status change
    if (newComment.outdated && !oldComment.outdated) {
      changes.push({ type: 'outdated', file: targetFile, comment: newComment });
    }
  }

  // Check for deleted comments
  for (const oldComment of oldComments) {
    const exists = newComments.find(c => c.id === oldComment.id);
    if (!exists) {
      changes.push({ type: 'deleted', file: targetFile, comment: oldComment });
    }
  }

  return changes;
}

function formatChange(change) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;

  switch (change.type) {
    case 'new_comment':
      return `${prefix} NEW_COMMENT: ${change.file}:${change.comment.line} - ${change.comment.title || 'No title'}`;
    case 'resolved':
      return `${prefix} RESOLVED: ${change.file}#${change.comment.id} - ${change.comment.title || 'No title'}`;
    case 'reply':
      return `${prefix} REPLY: ${change.file}#${change.commentId} by ${change.reply.author}: ${change.reply.message}`;
    case 'edited':
      return `${prefix} EDITED: ${change.file}#${change.comment.id}`;
    case 'outdated':
      return `${prefix} OUTDATED: ${change.file}#${change.comment.id} - line ${change.comment.line}`;
    case 'deleted':
      return `${prefix} DELETED: ${change.file}#${change.comment.id}`;
    default:
      return `${prefix} CHANGE: ${JSON.stringify(change)}`;
  }
}

function getSummary(allComments) {
  let total = 0;
  let resolved = 0;
  let unresolved = 0;
  let outdated = 0;

  for (const comments of allComments.values()) {
    for (const comment of comments) {
      total++;
      if (comment.outdated) {
        outdated++;
      } else if (comment.resolved) {
        resolved++;
      } else {
        unresolved++;
      }
    }
  }

  return { total, resolved, unresolved, outdated };
}

function watchFiles() {
  if (filesWatcher) {
    filesWatcher.close();
    filesWatcher = null;
  }

  if (!fs.existsSync(filesDir)) {
    console.log(`[WATCH] Files directory does not exist, waiting...`);
    return;
  }

  // Load initial state
  const allComments = loadAllComments();
  for (const [file, comments] of allComments) {
    previousStates.set(file, comments);
  }

  const summary = getSummary(allComments);
  console.log(`[WATCH] Watching: ${filesDir}`);
  console.log(`[WATCH] Initial state: ${summary.total} comments (${summary.resolved} resolved, ${summary.unresolved} unresolved, ${summary.outdated} outdated)`);

  filesWatcher = fs.watch(filesDir, { persistent: true }, (eventType, filename) => {
    if (!filename?.endsWith('.jsonl.gz')) return;

    // Debounce
    setTimeout(() => {
      const targetFile = decodeFilePath(filename);
      const oldComments = previousStates.get(targetFile) || [];
      const newComments = loadComments(targetFile);

      const changes = detectChanges(targetFile, oldComments, newComments);

      for (const change of changes) {
        console.log(formatChange(change));
      }

      if (changes.length > 0) {
        previousStates.set(targetFile, newComments);

        const allComments = loadAllComments();
        const summary = getSummary(allComments);
        console.log(`[SUMMARY] ${summary.total} comments (${summary.resolved} resolved, ${summary.unresolved} unresolved, ${summary.outdated} outdated)`);

        if (summary.unresolved === 0 && summary.total > 0) {
          console.log(`[ALL_RESOLVED] All comments have been resolved!`);
        }
      }
    }, 100);
  });
}

// Initial setup
console.log(`[WATCH] Starting review watcher on: ${reviewDir}`);

// Watch for review directory structure
function setup() {
  if (!fs.existsSync(reviewDir)) {
    console.log(`[WATCH] Review directory does not exist, waiting...`);
    return;
  }

  if (fs.existsSync(filesDir)) {
    watchFiles();
  }

  // Watch review dir for files/ creation
  fs.watch(reviewDir, { persistent: true }, (eventType, filename) => {
    if (filename === 'files') {
      setTimeout(() => {
        if (fs.existsSync(filesDir)) {
          console.log(`[WATCH] Files directory created`);
          watchFiles();
        }
      }, 100);
    }
  });
}

// Start watching
if (fs.existsSync(reviewDir)) {
  setup();
} else {
  // Watch for .review directory creation
  const parentDir = path.dirname(reviewDir);
  if (fs.existsSync(parentDir)) {
    console.log(`[WATCH] Waiting for .review directory creation...`);
    fs.watch(parentDir, (eventType, filename) => {
      if (filename === '.review' && fs.existsSync(reviewDir)) {
        console.log(`[WATCH] .review directory created`);
        setup();
      }
    });
  }
}

// Keep process alive
process.stdin.resume();
