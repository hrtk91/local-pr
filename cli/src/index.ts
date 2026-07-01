#!/usr/bin/env node
/**
 * leview — Local Review CLI
 * Comment creation, listing, resolution, and git-diff integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as https from 'https';
import * as readline from 'readline';
import { execSync } from 'child_process';
import {
  getFilesDir,
  getProjectName,
  getConfigPath,
  ensureStorageDir,
  readConfig,
  writeConfig,
  ProjectConfig,
} from './storage';

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
// Git helpers (CLI-local, lightweight)
// ============================================================

function gitExec(cmd: string, cwd?: string): string | undefined {
  try {
    return execSync(cmd, {
      cwd: cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

// ============================================================
// Base branch auto-detection
// (mirrors src/gitService.ts detectBaseBranch)
// ============================================================

function detectBaseBranch(): string {
  const currentBranch = gitExec('git branch --show-current');

  // 1. Upstream tracking branch
  try {
    const upstream = gitExec('git rev-parse --abbrev-ref @{upstream}');
    if (upstream) {
      const base = upstream.replace(/^origin\//, '');
      if (base !== currentBranch) return base;
    }
  } catch { /* no upstream */ }

  // 2. Closest branch by merge-base distance
  try {
    const raw = gitExec('git for-each-ref --format=%(refname:short) refs/heads/');
    if (raw) {
      const branches = raw
        .split('\n')
        .filter(b => b && b !== currentBranch);

      let bestBranch: string | undefined;
      let bestDistance = Infinity;

      for (const branch of branches) {
        try {
          const mergeBase = gitExec(`git merge-base HEAD ${branch}`);
          if (!mergeBase) continue;
          const count = gitExec(`git rev-list --count ${mergeBase}..HEAD`);
          const distance = parseInt(count ?? '', 10);
          if (!isNaN(distance) && distance < bestDistance) {
            bestDistance = distance;
            bestBranch = branch;
          }
        } catch { continue; }
      }
      if (bestBranch) return bestBranch;
    }
  } catch { /* ignore */ }

  // 3. Fallback
  for (const candidate of ['main', 'master', 'develop']) {
    if (gitExec(`git rev-parse --verify ${candidate}`)) {
      return candidate;
    }
  }

  return 'main';
}

// ============================================================
// Config bootstrap — auto-detect on first run
// ============================================================

function ensureConfig(): ProjectConfig {
  let config = readConfig();

  if (!config.baseBranch) {
    config.baseBranch = detectBaseBranch();
    config.targetRef = config.targetRef ?? 'HEAD';
    config.projectName = config.projectName ?? getProjectName();
    ensureStorageDir();
    writeConfig(config);
  }

  return config;
}

// ============================================================
// File Operations (using ~/.local-review/<hash>/files/)
// ============================================================

function getCommentsPath(targetFile: string): string {
  const encoded = encodeURIComponent(targetFile.replace(/\\/g, '/'));
  return path.join(getFilesDir(), `${encoded}.jsonl.gz`);
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
  const filesDir = getFilesDir();
  if (!fs.existsSync(filesDir)) return [];
  return fs
    .readdirSync(filesDir)
    .filter(f => f.endsWith('.jsonl.gz'))
    .map(f => decodeURIComponent(path.basename(f, '.jsonl.gz')));
}

// ============================================================
// Existing Commands
// ============================================================

function cmdAdd(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1];
  }

  const { file, line, message, severity = 'info', title, 'end-line': endLine } = opts;
  if (!file || !line || !message) {
    console.error(
      'Usage: add --file <path> --line <num> --message <text> [--severity error|warning|info] [--title <text>] [--end-line <num>]',
    );
    process.exit(1);
  }

  const validSeverities = ['error', 'warning', 'info'];
  if (!validSeverities.includes(severity)) {
    console.error(`Invalid severity: ${severity}. Must be one of: ${validSeverities.join(', ')}`);
    process.exit(1);
  }

  ensureStorageDir();
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
    const icon = c.severity === 'error' ? '!!' : c.severity === 'warning' ? '! ' : '  ';
    console.log(`  #${c.id} ${icon} L${c.line}${c.endLine ? `-${c.endLine}` : ''} ${status}`);
    if (c.title) console.log(`     ${c.title}`);
    console.log(`     ${c.message.split('\n')[0]}${c.message.includes('\n') ? '...' : ''}`);
    if (c.replies?.length) {
      console.log(`     ${c.replies.length} replies`);
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
// New Commands
// ============================================================

function cmdStatus() {
  const config = ensureConfig();

  const projectName = config.projectName ?? getProjectName();
  const base = config.baseBranch ?? 'main';
  const target = config.targetRef ?? 'HEAD';

  // Current branch + short SHA
  const branch = gitExec('git branch --show-current') ?? 'detached';
  const shortSha = gitExec('git rev-parse --short HEAD') ?? '???????';
  const targetDisplay = target === 'HEAD' ? `HEAD (${branch} @ ${shortSha})` : target;

  console.log(`Project: ${projectName}`);
  console.log(`Base:    ${base}`);
  console.log(`Target:  ${targetDisplay}`);
  console.log('');

  // Changed files summary
  const mergeBase = gitExec(`git merge-base HEAD ${base}`);
  if (mergeBase) {
    const nameStatus = gitExec(`git diff ${mergeBase} --name-status`);
    if (nameStatus) {
      const lines = nameStatus.split('\n').filter(Boolean);
      let modified = 0,
        added = 0,
        deleted = 0,
        other = 0;

      for (const line of lines) {
        const status = line.charAt(0);
        if (status === 'M') modified++;
        else if (status === 'A') added++;
        else if (status === 'D') deleted++;
        else other++;
      }

      const total = modified + added + deleted + other;
      console.log(`Changed files: ${total}`);
      const parts: string[] = [];
      if (modified) parts.push(`Modified: ${modified}`);
      if (added) parts.push(`Added: ${added}`);
      if (deleted) parts.push(`Deleted: ${deleted}`);
      if (other) parts.push(`Other: ${other}`);
      console.log(`  ${parts.join(', ')}`);
    } else {
      console.log('Changed files: 0');
    }
  } else {
    console.log('Changed files: (unable to compute merge-base)');
  }

  console.log('');

  // Comment counts
  const files = getAllReviewedFiles();
  let unresolved = 0;
  let resolved = 0;

  for (const f of files) {
    const comments = readComments(f);
    for (const c of comments) {
      if (c.resolved) resolved++;
      else unresolved++;
    }
  }

  console.log(`Comments: ${unresolved} unresolved, ${resolved} resolved`);
}

function cmdDiffFiles(args: string[]) {
  const config = ensureConfig();
  const base = config.baseBranch ?? 'main';
  const jsonMode = args.includes('--json');

  const mergeBase = gitExec(`git merge-base HEAD ${base}`);
  if (!mergeBase) {
    console.error(`Cannot determine merge-base between HEAD and ${base}`);
    process.exit(1);
  }

  const nameStatus = gitExec(`git diff ${mergeBase} --name-status`);
  if (!nameStatus) {
    if (jsonMode) {
      console.log('[]');
    }
    return;
  }

  const entries = nameStatus
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { status: status.charAt(0), path: pathParts.join('\t') };
    });

  if (jsonMode) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    for (const entry of entries) {
      console.log(`${entry.status}  ${entry.path}`);
    }
  }
}

function cmdDiff(args: string[]) {
  const config = ensureConfig();
  const base = config.baseBranch ?? 'main';

  // Find the file argument (first arg that doesn't start with --)
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: diff <file>');
    process.exit(1);
  }

  const mergeBase = gitExec(`git merge-base HEAD ${base}`);
  if (!mergeBase) {
    console.error(`Cannot determine merge-base between HEAD and ${base}`);
    process.exit(1);
  }

  try {
    const output = execSync(`git diff ${mergeBase} -- ${file}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    process.stdout.write(output);
  } catch (e: unknown) {
    // git diff exits 1 when there are differences — that's normal
    if (e && typeof e === 'object' && 'stdout' in e) {
      process.stdout.write((e as { stdout: Buffer }).stdout);
    }
  }
}

function cmdConfig(args: string[]) {
  // Filter out flags
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length === 0) {
    // Print all config
    const config = ensureConfig();
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (positional.length === 1) {
    // Print single key
    const config = ensureConfig();
    const key = normalizeConfigKey(positional[0]);
    const value = config[key as keyof ProjectConfig];
    if (value !== undefined) {
      console.log(value);
    } else {
      console.error(`Unknown config key: ${positional[0]}`);
      process.exit(1);
    }
    return;
  }

  // Set key=value
  const key = normalizeConfigKey(positional[0]);
  const value = positional[1];

  const config = ensureConfig();
  (config as Record<string, string>)[key] = value;
  writeConfig(config);
  console.log(`Set ${key} = ${value}`);
}

function normalizeConfigKey(key: string): string {
  // Accept shorthand: base → baseBranch, target → targetRef
  const aliases: Record<string, string> = {
    base: 'baseBranch',
    target: 'targetRef',
    projectName: 'projectName',
    baseBranch: 'baseBranch',
    targetRef: 'targetRef',
  };
  return aliases[key] ?? key;
}

// ============================================================
// Install Skill
// ============================================================

function getSkillDirectories(
  scope: 'local' | 'global' | 'all' = 'all',
): Array<{ path: string; scope: 'local' | 'global' }> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = ['.claude', '.cursor', '.codex'];
  const dirs: Array<{ path: string; scope: 'local' | 'global' }> = [];

  if (scope === 'local' || scope === 'all') {
    for (const dir of candidates) {
      const localPath = path.join(process.cwd(), dir);
      if (fs.existsSync(localPath)) {
        dirs.push({ path: localPath, scope: 'local' });
      }
    }
  }

  if (scope === 'global' || scope === 'all') {
    for (const dir of candidates) {
      const globalPath = path.join(home, dir);
      if (fs.existsSync(globalPath)) {
        dirs.push({ path: globalPath, scope: 'global' });
      }
    }
  }

  return dirs;
}

function downloadFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        if (res.headers.location) {
          downloadFile(res.headers.location).then(resolve).catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', reject);
  });
}

function askUserChoice(question: string, choices: string[]): Promise<number> {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(question);
    choices.forEach((choice, i) => {
      console.log(`  ${i + 1}. ${choice}`);
    });
    console.log('');

    rl.question('Select (number): ', answer => {
      rl.close();
      const num = parseInt(answer.trim());
      if (num >= 1 && num <= choices.length) {
        resolve(num - 1);
      } else {
        console.error('Invalid choice. Please try again.');
        process.exit(1);
      }
    });
  });
}

async function cmdInstallSkill(args: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) {
      opts[args[i].replace(/^--/, '')] = args[i + 1] || 'true';
    }
  }

  console.log('Checking for skill directories...');

  const scope = (opts['scope'] || 'all') as 'local' | 'global' | 'all';
  if (!['local', 'global', 'all'].includes(scope)) {
    console.error('Invalid --scope value. Must be one of: local, global, all');
    process.exit(1);
  }

  const skillDirs = getSkillDirectories(scope);
  if (skillDirs.length === 0) {
    const scopeMsg =
      scope === 'local'
        ? 'current directory (./.claude, ./.cursor, ./.codex)'
        : scope === 'global'
          ? 'home directory (~/.claude, ~/.cursor, ~/.codex)'
          : 'current or home directory';
    console.error(`No skill directories found in ${scopeMsg}`);
    process.exit(1);
  }

  const displayDirs = skillDirs.map(d => `${path.basename(d.path)} (${d.scope})`).join(', ');
  console.log(`Found: ${displayDirs}`);
  console.log('');

  let selectedDirs: string[];

  if (opts['all'] === 'true') {
    selectedDirs = skillDirs.map(d => d.path);
    console.log('Installing to all directories...');
  } else if (opts['dir']) {
    const requestedDir = opts['dir'];
    const matchedDir = skillDirs.find(d => path.basename(d.path) === requestedDir);
    if (!matchedDir) {
      console.error(
        `Directory '${requestedDir}' not found. Available: ${skillDirs.map(d => path.basename(d.path)).join(', ')}`,
      );
      process.exit(1);
    }
    selectedDirs = [matchedDir.path];
    console.log(`Installing to ${requestedDir} (${matchedDir.scope})...`);
  } else if (skillDirs.length === 1) {
    selectedDirs = [skillDirs[0].path];
    console.log(`Installing to ${path.basename(skillDirs[0].path)} (${skillDirs[0].scope})...`);
  } else if (process.stdin.isTTY) {
    const choices = [
      ...skillDirs.map(d => `${path.basename(d.path)} (${d.scope})`),
      'All of the above',
    ];

    const choice = await askUserChoice(
      'Which directory should the skill be installed to?',
      choices,
    );

    if (choice === skillDirs.length) {
      selectedDirs = skillDirs.map(d => d.path);
    } else {
      selectedDirs = [skillDirs[choice].path];
    }
  } else {
    const defaultDir =
      skillDirs.find(d => path.basename(d.path) === '.claude' && d.scope === 'global') ??
      skillDirs[0];
    selectedDirs = [defaultDir.path];
    console.log(
      `Non-interactive mode: defaulting to ${path.basename(defaultDir.path)} (${defaultDir.scope})`,
    );
    console.log(
      'Tip: Use --scope <local|global|all>, --dir <name>, or --all to specify installation target',
    );
  }

  console.log('');
  console.log('Downloading skill from GitHub...');

  const skillUrl =
    'https://raw.githubusercontent.com/hrtk91/local-pr/master/cli/skills/reviewing-locally/SKILL.md';

  try {
    const content = await downloadFile(skillUrl);

    for (const baseDir of selectedDirs) {
      const skillPath = path.join(baseDir, 'skills', 'reviewing-locally');
      const skillFile = path.join(skillPath, 'SKILL.md');

      if (!fs.existsSync(skillPath)) {
        fs.mkdirSync(skillPath, { recursive: true });
      }

      fs.writeFileSync(skillFile, content, 'utf-8');
      console.log(`Installed to ${path.relative(process.env.HOME || '', skillFile)}`);
    }

    console.log('');
    console.log('Skill installation complete!');
    console.log('');
    console.log('Usage in Claude Code/Cursor:');
    console.log('  /reviewing-locally');
  } catch (error) {
    console.error(
      'Failed to install skill:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

// ============================================================
// Main
// ============================================================

const [, , command, ...args] = process.argv;

(async () => {
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
    case 'status':
      cmdStatus();
      break;
    case 'diff-files':
      cmdDiffFiles(args);
      break;
    case 'diff':
      cmdDiff(args);
      break;
    case 'config':
      cmdConfig(args);
      break;
    case 'install-skill':
      await cmdInstallSkill(args);
      break;
    default:
      console.log(`leview — Local Review CLI

Commands:
  status        Show project status and comment summary
  diff-files    List changed files (vs base branch)
  diff <file>   Show diff for a specific file
  config        View or set project configuration
  add           Add a new comment
  list          List comments
  resolve       Mark comment as resolved
  reply         Add reply to a comment
  delete        Delete a comment
  install-skill Install Claude Code skill

Examples:
  leview status
  leview diff-files --json
  leview diff src/App.tsx
  leview config base develop
  leview add --file src/App.tsx --line 42 --message "Add null check" --severity warning
  leview list --active true
  leview list --file src/App.tsx --format json
  leview resolve --file src/App.tsx --id 1
  leview reply --file src/App.tsx --id 1 --message "Fixed"
  leview delete --file src/App.tsx --id 1
  leview install-skill
`);
  }
})();
