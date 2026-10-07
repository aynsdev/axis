import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { RunHandle, RunHandlers } from './types.ts';

/** Env vars that make a child CLI think it is nested inside another agent session. */
const STRIP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_THREAD_ID'];

interface SpawnOptions {
  bin: string;
  args: string[];
  cwd: string;
  stdin: string;
  on: RunHandlers;
  /** Handles one parsed JSONL line. Returns an error message if the line reports failure. */
  onJson(msg: any): string | void;
}

/** Spawns a CLI that prints JSONL to stdout and turns it into a RunHandle. */
export function spawnJsonl({ bin, args, cwd, stdin, on, onJson }: SpawnOptions): RunHandle {
  const env = { ...process.env };
  for (const k of STRIP_ENV) delete env[k];

  const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(stdin);

  let reportedError: string | undefined;
  let cancelled = false;

  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      on.event('system', line);
      return;
    }
    try {
      const err = onJson(msg);
      if (err) reportedError = err;
    } catch (e) {
      on.event('error', `Could not handle agent output: ${(e as Error).message}`);
    }
  });

  createInterface({ input: child.stderr }).on('line', (line) => {
    if (line.trim()) on.event('stderr', line);
  });

  const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    child.on('error', (e) => resolve({ ok: false, error: `Failed to start ${bin}: ${e.message}` }));
    child.on('close', (code, signal) => {
      if (cancelled) return resolve({ ok: false, error: 'Cancelled' });
      if (reportedError) return resolve({ ok: false, error: reportedError });
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, error: `${bin} exited with ${signal ?? `code ${code}`}` });
    });
  });

  return {
    pid: child.pid,
    done,
    cancel() {
      if (child.exitCode !== null) return;
      cancelled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref();
    },
  };
}

export const truncate = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}…` : s);
