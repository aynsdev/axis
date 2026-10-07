import type { Task, TaskEventKind } from '@axis/shared';

export interface RunHandlers {
  event(kind: TaskEventKind, text: string): void;
  session(id: string): void;
  usage(delta: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; costUsd?: number }): void;
  summary(text: string): void;
}

export interface RunResult {
  ok: boolean;
  error?: string;
}

export interface RunHandle {
  pid: number | undefined;
  done: Promise<RunResult>;
  cancel(): void;
}

export type Runner = (task: Task, cwd: string, on: RunHandlers) => RunHandle;
