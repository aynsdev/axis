import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.ts';

const exec = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim();
}

/** Resolves a path to its repository root and detects the default branch. */
export async function inspectRepo(path: string): Promise<{ root: string; name: string; defaultBranch: string }> {
  if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`);
  let root: string;
  try {
    root = await git(path, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`Not a git repository: ${path}`);
  }
  let defaultBranch: string;
  try {
    defaultBranch = (await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '');
  } catch {
    defaultBranch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  }
  return { root, name: basename(root), defaultBranch };
}

export function worktreePathFor(repoName: string, taskId: string) {
  return join(config.worktreesDir, `${repoName}-${taskId}`);
}

export async function createWorktree(repoPath: string, dir: string, branch: string, base: string) {
  await git(repoPath, ['worktree', 'add', '-b', branch, dir, base]);
}

export async function removeWorktree(repoPath: string, dir: string) {
  await git(repoPath, ['worktree', 'remove', '--force', dir]);
}

/** Commits anything the agent left uncommitted so the branch is ready for a PR. */
export async function commitLeftovers(dir: string, message: string): Promise<boolean> {
  const status = await git(dir, ['status', '--porcelain']);
  if (!status) return false;
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', message, '--no-verify']);
  return true;
}

const MAX_PATCH = 400_000;

/** Compares a branch to its base. `head` defaults to the checked-out branch, so a worktree can pass nothing. */
export async function diffAgainstBase(dir: string, base: string, head = 'HEAD') {
  const range = `${base}...${head}`;
  const [stat, patch, ahead] = await Promise.all([
    git(dir, ['diff', '--stat', range]),
    git(dir, ['diff', range]),
    git(dir, ['rev-list', '--count', `${base}..${head}`]),
  ]);
  return {
    stat,
    patch: patch.length > MAX_PATCH ? `${patch.slice(0, MAX_PATCH)}\n\n… diff truncated` : patch,
    commitsAhead: Number(ahead),
  };
}
