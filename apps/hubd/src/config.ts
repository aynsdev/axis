import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

/** Falls back to the pre-rename `~/.aynshq` so existing tasks and worktrees keep working. */
const legacyDir = join(homedir(), '.aynshq');
const defaultDir = join(homedir(), '.axis');
const dataDir = process.env.AXIS_HOME ?? (!existsSync(defaultDir) && existsSync(legacyDir) ? legacyDir : defaultDir);

export const config = {
  host: '127.0.0.1',
  port: Number(process.env.AXIS_PORT ?? 4317),
  dataDir,
  dbPath: join(dataDir, 'hub.db'),
  worktreesDir: join(dataDir, 'worktrees'),
  maxConcurrency: Number(process.env.AXIS_MAX_CONCURRENCY ?? 3),
  claudeBin: process.env.AXIS_CLAUDE_BIN ?? 'claude',
  codexBin: process.env.AXIS_CODEX_BIN ?? 'codex',
  /** Where notification clicks open; the dashboard's dev server by default. */
  webUrl: (process.env.AXIS_WEB_URL ?? 'http://127.0.0.1:5317').replace(/\/$/, ''),
};

mkdirSync(config.worktreesDir, { recursive: true });
