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
/**
 * Return a deterministic 12-char hex hash identifying the project.
 * Prefers `git remote get-url origin`; falls back to the absolute workspace path.
 */
export declare function getProjectHash(cwd?: string): string;
/**
 * Base storage directory: `~/.local-review/<hash>/`
 */
export declare function getStorageDir(cwd?: string): string;
/**
 * Comment files directory: `~/.local-review/<hash>/files/`
 */
export declare function getFilesDir(cwd?: string): string;
/**
 * Per-project config path: `~/.local-review/<hash>/config.json`
 */
export declare function getConfigPath(cwd?: string): string;
/**
 * Derive a human-readable project name from the git remote URL.
 * Examples:
 *   git@github.com:mi-labo/school_health_dx.git  → mi-labo/school_health_dx
 *   https://github.com/hrtk91/local-pr.git       → hrtk91/local-pr
 * Falls back to the directory basename when no remote is available.
 */
export declare function getProjectName(cwd?: string): string;
/**
 * Create the storage directory tree if it doesn't exist.
 */
export declare function ensureStorageDir(cwd?: string): void;
export type ProjectConfig = {
    baseBranch?: string;
    targetRef?: string;
    projectName?: string;
};
export declare function readConfig(cwd?: string): ProjectConfig;
export declare function writeConfig(config: ProjectConfig, cwd?: string): void;
