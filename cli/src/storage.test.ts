import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as path from 'path';

// We test through the public API of storage.ts.
// Some functions depend on `git` and `process.cwd()`, so we mock child_process.

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import {
  getProjectHash,
  getStorageDir,
  getFilesDir,
  getConfigPath,
  getProjectName,
} from './storage';

const mockedExecSync = vi.mocked(execSync);

describe('storage', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = '/home/testuser';
    mockedExecSync.mockReset();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  // ---- getProjectHash ----

  describe('getProjectHash', () => {
    it('returns a 12-char hex string', () => {
      // Simulate git remote returning a URL
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('https://github.com/mi-labo/school_health_dx.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      const hash = getProjectHash('/workspace/project');
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it('is deterministic for the same remote URL', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('https://github.com/mi-labo/school_health_dx.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      const hash1 = getProjectHash('/workspace/project');
      const hash2 = getProjectHash('/workspace/project');
      expect(hash1).toBe(hash2);
    });

    it('matches manual SHA256 of the remote URL', () => {
      const remoteUrl = 'https://github.com/mi-labo/school_health_dx.git';
      mockedExecSync.mockImplementation((cmd: string) => {
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

      expect(getProjectHash('/workspace/project')).toBe(expected);
    });

    it('falls back to workspace path hash when no remote', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
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

      expect(getProjectHash('/workspace/project')).toBe(expected);
    });
  });

  // ---- getStorageDir ----

  describe('getStorageDir', () => {
    it('returns ~/.local-review/<hash>/', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('https://github.com/example/repo.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      const dir = getStorageDir('/workspace/project');
      expect(dir).toMatch(/^\/home\/testuser\/\.local-review\/[0-9a-f]{12}$/);
    });
  });

  // ---- getFilesDir ----

  describe('getFilesDir', () => {
    it('appends /files to storage dir', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('https://github.com/example/repo.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      const dir = getFilesDir('/workspace/project');
      expect(dir).toBe(path.join(getStorageDir('/workspace/project'), 'files'));
    });
  });

  // ---- getConfigPath ----

  describe('getConfigPath', () => {
    it('returns config.json inside storage dir', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('https://github.com/example/repo.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      const p = getConfigPath('/workspace/project');
      expect(p).toBe(path.join(getStorageDir('/workspace/project'), 'config.json'));
    });
  });

  // ---- getProjectName ----

  describe('getProjectName', () => {
    it('extracts owner/repo from HTTPS URL', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('https://github.com/mi-labo/school_health_dx.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      expect(getProjectName('/workspace/project')).toBe('mi-labo/school_health_dx');
    });

    it('extracts owner/repo from SSH URL', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          return Buffer.from('git@github.com:hrtk91/local-pr.git\n');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/project\n');
        }
        return Buffer.from('');
      });

      expect(getProjectName('/workspace/project')).toBe('hrtk91/local-pr');
    });

    it('falls back to directory basename when no remote', () => {
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('get-url origin')) {
          throw new Error('fatal: No such remote');
        }
        if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
          return Buffer.from('/workspace/my-project\n');
        }
        return Buffer.from('');
      });

      expect(getProjectName('/workspace/my-project')).toBe('my-project');
    });
  });
});
