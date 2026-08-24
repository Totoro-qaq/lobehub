import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Benchmark artifacts must identify source that exists as an exact Git commit. */
export const getCleanRevision = async (repositoryRoot: string): Promise<string> => {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: repositoryRoot,
    }),
  ]);

  if (status.trim()) {
    throw new Error('Search benchmark requires a clean Git worktree');
  }

  return revision.trim();
};
