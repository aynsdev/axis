import type { Task, TaskEventKind } from '@aynshq/shared';
import { bus } from './bus.ts';
import { events, tasks, type TaskPatch } from './db.ts';

/** Persists a task change and broadcasts it to dashboards. */
export function updateTask(id: string, patch: TaskPatch): Task {
  const task = tasks.update(id, patch);
  bus.publish({ type: 'task.updated', task });
  return task;
}

/** Appends to a task's activity log and broadcasts it. */
export function emitEvent(taskId: string, kind: TaskEventKind, text: string) {
  bus.publish({ type: 'task.event', event: events.add(taskId, kind, text) });
}
