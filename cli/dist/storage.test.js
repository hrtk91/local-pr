"use strict";
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
const vitest_1 = require("vitest");
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
// We test through the public API of storage.ts.
// Some functions depend on `git` and `process.cwd()`, so we mock child_process.
vitest_1.vi.mock('child_process', () => ({
    execSync: vitest_1.vi.fn(),
}));
const child_process_1 = require("child_process");
const storage_1 = require("./storage");
const mockedExecSync = vitest_1.vi.mocked(child_process_1.execSync);
(0, vitest_1.describe)('storage', () => {
    const originalHome = process.env.HOME;
    (0, vitest_1.beforeEach)(() => {
        process.env.HOME = '/home/testuser';
        mockedExecSync.mockReset();
    });
    (0, vitest_1.afterEach)(() => {
        process.env.HOME = originalHome;
    });
    // ---- getProjectHash ----
    (0, vitest_1.describe)('getProjectHash', () => {
        (0, vitest_1.it)('returns a 12-char hex string', () => {
            // Simulate git remote returning a URL
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('https://github.com/mi-labo/school_health_dx.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const hash = (0, storage_1.getProjectHash)('/workspace/project');
            (0, vitest_1.expect)(hash).toMatch(/^[0-9a-f]{12}$/);
        });
        (0, vitest_1.it)('is deterministic for the same remote URL', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('https://github.com/mi-labo/school_health_dx.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const hash1 = (0, storage_1.getProjectHash)('/workspace/project');
            const hash2 = (0, storage_1.getProjectHash)('/workspace/project');
            (0, vitest_1.expect)(hash1).toBe(hash2);
        });
        (0, vitest_1.it)('matches manual SHA256 of the remote URL', () => {
            const remoteUrl = 'https://github.com/mi-labo/school_health_dx.git';
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from(remoteUrl + '\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const expected = crypto
                .createHash('sha256')
                .update(remoteUrl)
                .digest('hex')
                .slice(0, 12);
            (0, vitest_1.expect)((0, storage_1.getProjectHash)('/workspace/project')).toBe(expected);
        });
        (0, vitest_1.it)('falls back to workspace path hash when no remote', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    throw new Error('fatal: No such remote');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const expected = crypto
                .createHash('sha256')
                .update('/workspace/project')
                .digest('hex')
                .slice(0, 12);
            (0, vitest_1.expect)((0, storage_1.getProjectHash)('/workspace/project')).toBe(expected);
        });
    });
    // ---- getStorageDir ----
    (0, vitest_1.describe)('getStorageDir', () => {
        (0, vitest_1.it)('returns ~/.local-review/<hash>/', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('https://github.com/example/repo.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const dir = (0, storage_1.getStorageDir)('/workspace/project');
            (0, vitest_1.expect)(dir).toMatch(/^\/home\/testuser\/\.local-review\/[0-9a-f]{12}$/);
        });
    });
    // ---- getFilesDir ----
    (0, vitest_1.describe)('getFilesDir', () => {
        (0, vitest_1.it)('appends /files to storage dir', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('https://github.com/example/repo.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const dir = (0, storage_1.getFilesDir)('/workspace/project');
            (0, vitest_1.expect)(dir).toBe(path.join((0, storage_1.getStorageDir)('/workspace/project'), 'files'));
        });
    });
    // ---- getConfigPath ----
    (0, vitest_1.describe)('getConfigPath', () => {
        (0, vitest_1.it)('returns config.json inside storage dir', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('https://github.com/example/repo.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            const p = (0, storage_1.getConfigPath)('/workspace/project');
            (0, vitest_1.expect)(p).toBe(path.join((0, storage_1.getStorageDir)('/workspace/project'), 'config.json'));
        });
    });
    // ---- getProjectName ----
    (0, vitest_1.describe)('getProjectName', () => {
        (0, vitest_1.it)('extracts owner/repo from HTTPS URL', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('https://github.com/mi-labo/school_health_dx.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            (0, vitest_1.expect)((0, storage_1.getProjectName)('/workspace/project')).toBe('mi-labo/school_health_dx');
        });
        (0, vitest_1.it)('extracts owner/repo from SSH URL', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    return Buffer.from('git@github.com:hrtk91/local-pr.git\n');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/project\n');
                }
                return Buffer.from('');
            });
            (0, vitest_1.expect)((0, storage_1.getProjectName)('/workspace/project')).toBe('hrtk91/local-pr');
        });
        (0, vitest_1.it)('falls back to directory basename when no remote', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
                    throw new Error('fatal: No such remote');
                }
                if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
                    return Buffer.from('/workspace/my-project\n');
                }
                return Buffer.from('');
            });
            (0, vitest_1.expect)((0, storage_1.getProjectName)('/workspace/my-project')).toBe('my-project');
        });
    });
});
