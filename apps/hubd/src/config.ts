import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const dataDir = process.env.AYNSHQ_HOME ?? join(homedir(), '.aynshq');

export const config = {
  host: '127.0.0.1',
  port: Number(process.env.AYNSHQ_PORT ?? 4317),
  dataDir,
  dbPath: join(dataDir, 'hub.db'),
  worktreesDir: join(dataDir, 'worktrees'),
  maxConcurrency: Number(process.env.AYNSHQ_MAX_CONCURRENCY ?? 3),
  claudeBin: process.env.AYNSHQ_CLAUDE_BIN ?? 'claude',
  codexBin: process.env.AYNSHQ_CODEX_BIN ?? 'codex',
  /** Where notification clicks open; the dashboard's dev server by default. */
  webUrl: (process.env.AYNSHQ_WEB_URL ?? 'http://127.0.0.1:5317').replace(/\/$/, ''),
};

mkdirSync(config.worktreesDir, { recursive: true });
