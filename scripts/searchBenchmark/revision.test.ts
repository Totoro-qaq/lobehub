import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { getCleanRevision } from './revision';

const execFileAsync = promisify(execFile);

describe('search benchmark revision', () => {
  it('returns the exact commit only for a clean worktree', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'search-benchmark-revision-'));
    await execFileAsync('git', ['init', '--quiet'], { cwd: repositoryRoot });
    await execFileAsync('git', ['config', 'user.email', 'search-benchmark@example.com'], {
      cwd: repositoryRoot,
    });
    await execFileAsync('git', ['config', 'user.name', 'Search Benchmark'], {
      cwd: repositoryRoot,
    });
    await writeFile(path.join(repositoryRoot, 'tracked.txt'), 'committed\n');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repositoryRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'test fixture'], {
      cwd: repositoryRoot,
    });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });

    await expect(getCleanRevision(repositoryRoot)).resolves.toBe(stdout.trim());

    await writeFile(path.join(repositoryRoot, 'untracked.txt'), 'dirty\n');
    await expect(getCleanRevision(repositoryRoot)).rejects.toThrow('requires a clean Git worktree');
  });
});
