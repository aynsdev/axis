import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ServerMessage, Task, TaskEvent } from '@axis/shared';
import { qk } from './api';
import { toasts } from './toasts';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/** Keeps the query cache in sync with hub events. Mount once at the app root. */
export function useLiveUpdates(): ConnectionState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let statsTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshStats = () => {
      clearTimeout(statsTimer);
      statsTimer = setTimeout(() => qc.invalidateQueries({ queryKey: qk.stats }), 300);
    };

    const onTask = (task: Task) => {
      qc.setQueryData<Task>(qk.task(task.id), task);
      qc.setQueryData<Task[]>(qk.tasks, (list) => {
        if (!list) return list;
        const i = list.findIndex((t) => t.id === task.id);
        if (i === -1) return [task, ...list];
        const next = list.slice();
        next[i] = task;
        return next;
      });
      refreshStats();
    };

    const onEvent = (event: TaskEvent) => {
      qc.setQueryData<TaskEvent[]>(qk.events(event.taskId), (list) =>
        list && !list.some((e) => e.id === event.id) ? [...list, event] : list,
      );
    };

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        setState('live');
        // Anything may have changed while we were disconnected.
        qc.invalidateQueries();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'task.updated') onTask(msg.task);
        else if (msg.type === 'task.event') onEvent(msg.event);
        else if (msg.type === 'notification') toasts.push(msg.notification);
        else if (msg.type === 'settings.updated') {
          qc.setQueryData(qk.settings, msg.settings);
          refreshStats();
        } else if (msg.type === 'workspace.updated') {
          qc.setQueryData(qk.workspace, msg.snapshot);
        } else if (msg.type === 'usage.updated') {
          qc.invalidateQueries({ queryKey: ['usage'] });
          qc.invalidateQueries({ queryKey: ['sessions'] });
          refreshStats();
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setState('offline');
        retry = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(statsTimer);
      ws?.close();
    };
  }, [qc]);

  return state;
}
