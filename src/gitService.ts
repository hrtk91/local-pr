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
    env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.quotepath', GIT_CONFIG_VALUE_0: 'false' },
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
 * Uses merge-base (fork point) as the actual diff base, so changes
 * merged into the base branch after branching off are excluded.
 *
 * When target is 'HEAD', compares merge-base against working tree
 * so uncommitted changes are included.
 */
export function getChangedFiles(workspacePath: string, base: string, target: string): ChangedFile[] {
  try {
    const remoteBase = resolveRemoteRef(workspacePath, base);
    const mergeBase = exec(`git merge-base HEAD ${remoteBase}`, workspacePath);
    const actualBase = mergeBase || remoteBase;

    const cmd = target === 'HEAD'
      ? `git diff --name-status ${actualBase}`
      : `git diff --name-status ${actualBase}..${target}`;
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
    const ref = resolveRemoteRef(workspacePath, commit);
    return execSync(
      `git show ${ref}:${filePath}`,
      { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 }
    );
  } catch {
    return undefined;
  }
}

/**
 * Detect the base branch for comparison.
 *
 * Priority:
 *   1. Upstream tracking branch (e.g. feature → origin/develop → develop)
 *   2. Closest branch by merge-base distance (handles detached HEAD / worktree)
 *   3. Fall back to first existing of main/master/develop
 *
 * Skips the current branch itself to avoid empty diffs.
 */
export function detectBaseBranch(workspacePath: string): string {
  const currentBranch = getCurrentBranch(workspacePath);

  // 1. Upstream tracking branch
  try {
    const upstream = exec('git rev-parse --abbrev-ref @{upstream}', workspacePath);
    if (upstream) {
      const base = upstream.replace(/^origin\//, '');
      if (base !== currentBranch) return base;
    }
  } catch { /* no upstream (detached HEAD etc.) */ }

  // 2. Closest branch by merge-base distance
  //    This correctly handles worktree/detached HEAD where upstream is unavailable.
  //    Includes all local branches to find the true parent (e.g. develop over main).
  try {
    const branches = getBranches(workspacePath)
      .filter(b => b !== currentBranch && !b.startsWith('origin/'));
    let bestBranch: string | undefined;
    let bestDistance = Infinity;

    for (const branch of branches) {
      try {
        const mergeBase = exec(`git merge-base HEAD ${branch}`, workspacePath);
        if (!mergeBase) continue;
        const count = exec(`git rev-list --count ${mergeBase}..HEAD`, workspacePath);
        const distance = parseInt(count, 10);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestBranch = branch;
        }
      } catch { continue; }
    }
    if (bestBranch) return bestBranch;
  } catch { /* ignore */ }

  // 3. Fallback: first existing common branch name
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      exec(`git rev-parse --verify ${candidate}`, workspacePath);
      return candidate;
    } catch { continue; }
  }

  return 'main';
}

/**
 * Prefer origin/<ref> over local <ref> when available.
 * Local branches can be stale; remote tracking refs are up to date after fetch.
 */
function resolveRemoteRef(workspacePath: string, ref: string): string {
  if (ref.includes('/')) return ref;
  try {
    exec(`git rev-parse --verify origin/${ref}`, workspacePath);
    return `origin/${ref}`;
  } catch {
    return ref;
  }
}

function getCurrentBranch(workspacePath: string): string | undefined {
  try {
    return exec('git branch --show-current', workspacePath) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get current HEAD info for display: branch name + short hash.
 */
export function getHeadDescription(workspacePath: string): string {
  try {
    const hash = exec('git rev-parse --short HEAD', workspacePath);
    const branch = getCurrentBranch(workspacePath);
    if (branch) return `${branch} (${hash})`;
    return hash || 'HEAD';
  } catch {
    return 'HEAD';
  }
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
