import type { Task } from '@axis/shared';
import { bus } from './bus.ts';
import { repos, tasks } from './db.ts';
import { commitLeftovers, createWorktree, worktreePathFor } from './git.ts';
import { emitEvent as emit, updateTask as update } from './live.ts';
import { notify } from './notify.ts';
import { openPr } from './pr.ts';
import { runners, type RunHandle } from './runners/index.ts';
import { getSettings } from './settings.ts';

const running = new Map<string, RunHandle>();
const now = () => new Date().toISOString();

async function start(task: Task) {
  const repo = repos.get(task.repoId);
  if (!repo) return update(task.id, { status: 'failed', error: 'Repository was removed', finishedAt: now() });

  // Reserve the slot before any await so concurrent ticks can't overbook.
  update(task.id, { status: 'running', startedAt: now() });

  const dir = worktreePathFor(repo.name, task.id);
  try {
    await createWorktree(repo.path, dir, task.branch, task.baseBranch);
    update(task.id, { worktreePath: dir });
    emit(task.id, 'system', `Worktree ready on ${task.branch} from ${task.baseBranch}`);
  } catch (e) {
    emit(task.id, 'error', (e as Error).message);
    update(task.id, { status: 'failed', error: 'Could not create worktree', finishedAt: now() });
    return tick();
  }

  const isCancelled = () => tasks.get(task.id)?.status === 'cancelled';
  if (isCancelled()) return tick();

  const handle = runners[task.agent](task, dir, {
    event: (kind, text) => emit(task.id, kind, text),
    session: (sessionId) => update(task.id, { sessionId }),
    usage: (delta) => {
      tasks.addUsage(task.id, delta);
      bus.publish({ type: 'task.updated', task: tasks.get(task.id)! });
    },
    summary: (summary) => update(task.id, { summary }),
  });
  running.set(task.id, handle);
  // Cancel may have landed while the process was spawning.
  if (isCancelled()) handle.cancel();
  else update(task.id, { pid: handle.pid ?? null });

  const result = await handle.done;
  running.delete(task.id);

  if (result.ok) {
    try {
      if (await commitLeftovers(dir, `hub: ${task.title}`)) emit(task.id, 'system', 'Committed remaining changes');
    } catch (e) {
      emit(task.id, 'error', `Auto-commit failed: ${(e as Error).message}`);
    }
  }

  const cancelled = isCancelled();
  const finished = update(task.id, {
    status: cancelled ? 'cancelled' : result.ok ? 'succeeded' : 'failed',
    error: cancelled || result.ok ? null : result.error ?? 'Unknown error',
    pid: null,
    finishedAt: now(),
  });
  tick();

  const path = `/tasks/${finished.id}`;
  if (finished.status === 'succeeded') {
    notify('task.succeeded', { title: `Done: ${finished.title}`, body: `${finished.repoName} · ${finished.branch}`, level: 'success', path });
  } else if (finished.status === 'failed') {
    notify('task.failed', { title: `Failed: ${finished.title}`, body: finished.error ?? 'Unknown error', level: 'error', path });
  }

  if (finished.status === 'succeeded' && finished.autoPr) {
    // Failures are logged on the task; the run itself still succeeded.
    await openPr(finished.id, { draft: true }, { auto: true }).catch(() => {});
  }
}

/** Starts queued tasks while there are free slots. */
export function tick() {
  const free = getSettings().maxConcurrency - tasks.list({ status: ['running'] }).length;
  if (free <= 0) return;
  for (const task of tasks.nextQueued(free)) void start(task);
}

export function enqueue(task: Task) {
  bus.publish({ type: 'task.updated', task });
  tick();
}

export function cancel(id: string): Task | undefined {
  const task = tasks.get(id);
  if (!task || (task.status !== 'queued' && task.status !== 'running')) return task;
  const updated = update(id, { status: 'cancelled', finishedAt: now() });
  running.get(id)?.cancel();
  emit(id, 'system', 'Cancelled by user');
  return updated;
}

export function recover() {
  const orphans = tasks.failOrphans();
  if (orphans) console.log(`[hubd] marked ${orphans} interrupted task(s) as failed`);
  tick();
}

export function shutdown() {
  for (const h of running.values()) h.cancel();
}
