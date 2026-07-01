/**
 * Storage resolution for local-review CLI.
 *
 * Storage layout:
 *   ~/.local-review/<project-hash>/
 *     files/          — JSONL+gzip comment files
 *     config.json     — per-project configuration
 *
 * The project hash is the first 12 hex chars of SHA256(git remote URL).
 * If no remote is configured, SHA256(absolute workspace path) is used instead.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================
// Helpers
// ============================================================

function sha256hex12(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function gitExec(cmd: string, cwd: string): string | undefined {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function resolveWorkspacePath(cwd?: string): string {
  if (cwd) return path.resolve(cwd);
  // Walk up to find the git root; fall back to process.cwd()
  const root = gitExec('git rev-parse --show-toplevel', process.cwd());
  return root ?? process.cwd();
}

// ============================================================
// Public API
// ============================================================

/**
 * Return a deterministic 12-char hex hash identifying the project.
 * Prefers `git remote get-url origin`; falls back to the absolute workspace path.
 */
export function getProjectHash(cwd?: string): string {
  const ws = resolveWorkspacePath(cwd);
  const remoteUrl = gitExec('git remote get-url origin', ws);
  const hashInput = remoteUrl ?? ws;
  return sha256hex12(hashInput);
}

/**
 * Base storage directory: `~/.local-review/<hash>/`
 */
export function getStorageDir(cwd?: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.local-review', getProjectHash(cwd));
}

/**
 * Comment files directory: `~/.local-review/<hash>/files/`
 */
export function getFilesDir(cwd?: string): string {
  return path.join(getStorageDir(cwd), 'files');
}

/**
 * Per-project config path: `~/.local-review/<hash>/config.json`
 */
export function getConfigPath(cwd?: string): string {
  return path.join(getStorageDir(cwd), 'config.json');
}

/**
 * Derive a human-readable project name from the git remote URL.
 * Examples:
 *   git@github.com:mi-labo/school_health_dx.git  → mi-labo/school_health_dx
 *   https://github.com/hrtk91/local-pr.git       → hrtk91/local-pr
 * Falls back to the directory basename when no remote is available.
 */
export function getProjectName(cwd?: string): string {
  const ws = resolveWorkspacePath(cwd);
  const remoteUrl = gitExec('git remote get-url origin', ws);

  if (remoteUrl) {
    // SSH: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/[:\/]([^\/]+\/[^\/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];
    // HTTPS or other: just grab last two path segments
    try {
      const url = new URL(remoteUrl);
      const segments = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
      if (segments.length >= 2) return segments.slice(-2).join('/');
    } catch {
      // Not a valid URL — return as-is stripped of .git
    }
    return remoteUrl.replace(/\.git$/, '');
  }

  return path.basename(ws);
}

/**
 * Create the storage directory tree if it doesn't exist.
 */
export function ensureStorageDir(cwd?: string): void {
  const filesDir = getFilesDir(cwd);
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
  }
}

// ============================================================
// Config helpers
// ============================================================

export type ProjectConfig = {
  baseBranch?: string;
  targetRef?: string;
  projectName?: string;
};

export function readConfig(cwd?: string): ProjectConfig {
  const configPath = getConfigPath(cwd);
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectConfig;
    }
  } catch { /* ignore corrupt config */ }
  return {};
}

export function writeConfig(config: ProjectConfig, cwd?: string): void {
  ensureStorageDir(cwd);
  const configPath = getConfigPath(cwd);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
