"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectHash = getProjectHash;
exports.getStorageDir = getStorageDir;
exports.getFilesDir = getFilesDir;
exports.getConfigPath = getConfigPath;
exports.getProjectName = getProjectName;
exports.ensureStorageDir = ensureStorageDir;
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
// ============================================================
// Helpers
// ============================================================
function sha256hex12(input) {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}
function gitExec(cmd, cwd) {
    try {
        return (0, child_process_1.execSync)(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
            .toString()
            .trim();
    }
    catch {
        return undefined;
    }
}
function resolveWorkspacePath(cwd) {
    if (cwd)
        return path.resolve(cwd);
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
function getProjectHash(cwd) {
    const ws = resolveWorkspacePath(cwd);
    const remoteUrl = gitExec('git remote get-url origin', ws);
    const hashInput = remoteUrl ?? ws;
    return sha256hex12(hashInput);
}
/**
 * Base storage directory: `~/.local-review/<hash>/`
 */
function getStorageDir(cwd) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.local-review', getProjectHash(cwd));
}
/**
 * Comment files directory: `~/.local-review/<hash>/files/`
 */
function getFilesDir(cwd) {
    return path.join(getStorageDir(cwd), 'files');
}
/**
 * Per-project config path: `~/.local-review/<hash>/config.json`
 */
function getConfigPath(cwd) {
    return path.join(getStorageDir(cwd), 'config.json');
}
/**
 * Derive a human-readable project name from the git remote URL.
 * Examples:
 *   git@github.com:mi-labo/school_health_dx.git  → mi-labo/school_health_dx
 *   https://github.com/hrtk91/local-pr.git       → hrtk91/local-pr
 * Falls back to the directory basename when no remote is available.
 */
function getProjectName(cwd) {
    const ws = resolveWorkspacePath(cwd);
    const remoteUrl = gitExec('git remote get-url origin', ws);
    if (remoteUrl) {
        // SSH: git@github.com:owner/repo.git
        const sshMatch = remoteUrl.match(/[:\/]([^\/]+\/[^\/]+?)(?:\.git)?$/);
        if (sshMatch)
            return sshMatch[1];
        // HTTPS or other: just grab last two path segments
        try {
            const url = new URL(remoteUrl);
            const segments = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
            if (segments.length >= 2)
                return segments.slice(-2).join('/');
        }
        catch {
            // Not a valid URL — return as-is stripped of .git
        }
        return remoteUrl.replace(/\.git$/, '');
    }
    return path.basename(ws);
}
/**
 * Create the storage directory tree if it doesn't exist.
 */
function ensureStorageDir(cwd) {
    const filesDir = getFilesDir(cwd);
    if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
    }
}
function readConfig(cwd) {
    const configPath = getConfigPath(cwd);
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    }
    catch { /* ignore corrupt config */ }
    return {};
}
function writeConfig(config, cwd) {
    ensureStorageDir(cwd);
    const configPath = getConfigPath(cwd);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
