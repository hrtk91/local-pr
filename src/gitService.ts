/**
 * GitService - Git operations for the Local Review sidebar.
 *
 * Provides functions to query git diff, file content at commits,
 * branch listing, and base branch detection.
 */

import { execSync } from 'child_process';

// ============================================================
// Types
// ============================================================

export type FileStatus = 'M' | 'A' | 'D' | 'R';

export type ChangedFile = {
  path: string;
  status: FileStatus;
  oldPath?: string;
};

// ============================================================
// Internal Helper
// ============================================================

function exec(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse `git diff --name-status` output into structured ChangedFile objects.
 *
 * Exported so unit tests can exercise the parsing logic without running git.
 */
export function parseNameStatus(output: string): ChangedFile[] {
  if (!output || !output.trim()) {
    return [];
  }

  const results: ChangedFile[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Lines must contain a tab to be valid name-status output
    const tabIndex = trimmed.indexOf('\t');
    if (tabIndex === -1) continue;

    const statusField = trimmed.substring(0, tabIndex);
    const rest = trimmed.substring(tabIndex + 1);

    if (statusField === 'M' || statusField === 'A' || statusField === 'D') {
      results.push({ status: statusField, path: rest });
    } else if (statusField.startsWith('R')) {
      // Rename: R<digits>\t<old-path>\t<new-path>
      const paths = rest.split('\t');
      if (paths.length < 2) continue; // malformed rename line
      results.push({ status: 'R', path: paths[1], oldPath: paths[0] });
    }
    // Unknown status codes (C, X, etc.) are silently skipped
  }

  // Sort alphabetically by path
  results.sort((a, b) => a.path.localeCompare(b.path));

  return results;
}

// ============================================================
// Git Operations
// ============================================================

/**
 * Get list of files changed between base and target refs.
 *
 * When target is 'HEAD', compares against the working tree
 * so uncommitted changes are included: `git diff base`
 * Otherwise uses two-dot notation: `git diff base..target`
 */
export function getChangedFiles(workspacePath: string, base: string, target: string): ChangedFile[] {
  try {
    const cmd = target === 'HEAD'
      ? `git diff --name-status ${base}`
      : `git diff --name-status ${base}..${target}`;
    const output = exec(cmd, workspacePath);
    if (!output) return [];
    return parseNameStatus(output);
  } catch {
    return [];
  }
}

/**
 * Get file content at a specific commit.
 * Returns undefined if the file doesn't exist at that commit.
 */
export function getFileContentAtCommit(workspacePath: string, commit: string, filePath: string): string | undefined {
  try {
    return execSync(
      `git show ${commit}:${filePath}`,
      { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 }
    );
  } catch {
    return undefined;
  }
}

/**
 * Detect the base branch for comparison.
 *
 * 2-tier detection (git only, no external CLI dependency):
 *   1. `git merge-base HEAD <defaultBranch>`
 *   2. Fall back to 'main'
 */
export function detectBaseBranch(workspacePath: string): string {
  const defaultBranch = getDefaultBranch(workspacePath);
  if (defaultBranch) {
    try {
      exec(`git merge-base HEAD ${defaultBranch}`, workspacePath);
      return defaultBranch;
    } catch {
      // merge-base failed
    }
  }

  return 'main';
}

/**
 * Get list of local branches.
 */
export function getBranches(workspacePath: string): string[] {
  try {
    const output = exec(
      'git branch --format="%(refname:short)"',
      workspacePath,
    );
    if (!output) return [];
    return output.split('\n').map(b => b.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get recent commits (last 20) as structured data.
 */
export function getRecentCommits(workspacePath: string): Array<{ hash: string; message: string }> {
  try {
    const output = exec(
      'git log --oneline -20 --format="%H %s"',
      workspacePath,
    );
    if (!output) return [];

    return output.split('\n').map(line => {
      const spaceIndex = line.indexOf(' ');
      return {
        hash: line.substring(0, spaceIndex),
        message: line.substring(spaceIndex + 1),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get the default branch name for the repository.
 *
 * Tries symbolic-ref first (most reliable when origin is set),
 * then checks if main or master exist locally.
 */
export function getDefaultBranch(workspacePath: string): string | undefined {
  // Try symbolic-ref (works when remote origin is configured)
  try {
    const ref = exec(
      'git symbolic-ref refs/remotes/origin/HEAD',
      workspacePath,
    );
    // ref looks like "refs/remotes/origin/main"
    const branch = ref.replace('refs/remotes/origin/', '');
    if (branch) return branch;
  } catch {
    // No remote HEAD configured
  }

  // Check for common branch names
  for (const candidate of ['main', 'master']) {
    try {
      exec(`git rev-parse --verify ${candidate}`, workspacePath);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}
