import type { OpenPrInput, Task } from '@aynshq/shared';
import { repos, tasks } from './db.ts';
import { commitLeftovers, diffAgainstBase } from './git.ts';
import { createPr, defaultPrBody, findPrForBranch, githubStatus, prStatus, pushBranch, remoteUrl } from './github.ts';
import { emitEvent, updateTask } from './live.ts';
import { notify } from './notify.ts';

export class PrError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const inFlight = new Set<string>();

/** Where git commands for the task's branch run: the worktree if it still exists, else the repo. */
function cwdFor(task: Task) {
  const repo = repos.get(task.repoId);
  if (!repo) throw new PrError('Repository was removed', 404);
  return { repo, cwd: task.worktreePath ?? repo.path };
}

/**
 * Pushes the task branch and opens a PR against its base branch.
 * Every step is logged on the task so failures are visible in its activity.
 */
export async function openPr(taskId: string, input: OpenPrInput, opts: { auto?: boolean } = {}): Promise<Task> {
  const task = tasks.get(taskId);
  if (!task) throw new PrError('Task not found', 404);
  if (task.status === 'running' || task.status === 'queued') throw new PrError('Wait for the task to finish', 409);
  if (task.pr) return task;
  if (inFlight.has(taskId)) throw new PrError('A pull request is already being opened', 409);

  inFlight.add(taskId);
  const label = opts.auto ? 'Auto PR' : 'PR';
  try {
    const { repo, cwd } = cwdFor(task);

    const gh = await githubStatus();
    if (!gh.installed) throw new PrError('GitHub CLI (gh) is not installed');
    if (!gh.authenticated) throw new PrError('GitHub CLI is not logged in. Run `gh auth login`.');
    if (!(await remoteUrl(repo.path))) throw new PrError(`${repo.name} has no "origin" remote to push to`);

    if (task.worktreePath && (await commitLeftovers(task.worktreePath, `hub: ${task.title}`))) {
      emitEvent(task.id, 'system', 'Committed remaining changes');
    }

    const diff = await diffAgainstBase(cwd, task.baseBranch, task.branch);
    if (diff.commitsAhead === 0) throw new PrError(`${task.branch} has no commits ahead of ${task.baseBranch}`);

    emitEvent(task.id, 'system', `${label}: pushing ${task.branch} to origin`);
    await pushBranch(cwd, task.branch);

    // The agent may have opened one itself.
    let pr = await findPrForBranch(cwd, task.branch);
    if (pr) {
      emitEvent(task.id, 'system', `${label}: found existing PR #${pr.number}`);
    } else {
      pr = await createPr(cwd, {
        base: task.baseBranch,
        head: task.branch,
        title: input.title?.trim() || task.title,
        body: input.body?.trim() || defaultPrBody(task, diff.stat),
        draft: input.draft ?? false,
      });
      emitEvent(task.id, 'system', `${label}: opened ${pr.state === 'draft' ? 'draft ' : ''}PR #${pr.number} · ${pr.url}`);
      if (opts.auto) {
        notify('pr.opened', { title: `Draft PR #${pr.number} opened`, body: task.title, level: 'info', path: `/tasks/${task.id}`, url: pr.url });
      }
    }
    return updateTask(task.id, { pr });
  } catch (e) {
    emitEvent(task.id, 'error', `${label} failed: ${(e as Error).message}`);
    throw e instanceof PrError ? e : new PrError((e as Error).message);
  } finally {
    inFlight.delete(taskId);
  }
}

export async function refreshPr(taskId: string): Promise<Task> {
  const task = tasks.get(taskId);
  if (!task) throw new PrError('Task not found', 404);
  if (!task.pr) throw new PrError('Task has no pull request', 409);
  const { cwd } = cwdFor(task);
  const pr = await prStatus(cwd, task.pr.url);
  const changed = pr.state !== task.pr.state || pr.checks !== task.pr.checks || pr.review !== task.pr.review;
  const path = `/tasks/${task.id}`;
  if (pr.state !== task.pr.state) {
    emitEvent(task.id, 'system', `PR #${pr.number} is now ${pr.state}`);
    if (pr.state === 'merged' || pr.state === 'closed') {
      notify('pr.merged', {
        title: `PR #${pr.number} ${pr.state}`,
        body: task.title,
        level: pr.state === 'merged' ? 'success' : 'warning',
        path,
        url: pr.url,
      });
    }
  }
  if (pr.checks === 'failing' && task.pr.checks !== 'failing') {
    emitEvent(task.id, 'error', `PR #${pr.number}: checks failing`);
    notify('pr.checksFailed', { title: `Checks failing on PR #${pr.number}`, body: task.title, level: 'error', path, url: pr.url });
  }
  return changed ? updateTask(task.id, { pr }) : tasks.update(task.id, { pr });
}

/** Keeps open PRs' state, checks and review status current. */
export function startPrPoller(intervalMs = 120_000) {
  const run = async () => {
    for (const t of tasks.withOpenPrs()) {
      try {
        await refreshPr(t.id);
      } catch {
        // Network or auth hiccups shouldn't spam the log; the next pass retries.
      }
    }
  };
  setTimeout(run, 5_000).unref();
  setInterval(run, intervalMs).unref();
}
