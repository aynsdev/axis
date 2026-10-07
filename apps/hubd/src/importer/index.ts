import { open, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Batch, parseClaudeLine, parseCodexLine, type CodexRateLimits, type ParseContext } from './parsers.ts';
import { alertLimits } from './limits.ts';
import { store, type FileRow } from './store.ts';

const HOME = homedir();
const CLAUDE_DIR = process.env.AXIS_CLAUDE_PROJECTS ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(HOME, '.claude'), 'projects');
const CODEX_HOME = process.env.CODEX_HOME ?? join(HOME, '.codex');
const CODEX_DIRS = [join(CODEX_HOME, 'sessions'), join(CODEX_HOME, 'archived_sessions')];

const CHUNK = 4 * 1024 * 1024;
const RESCAN_MS = 60_000;

type Agent = 'claude' | 'codex';

async function listJsonl(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(e.parentPath, e.name));
}

/** Codex keeps user-visible thread names in a separate index. */
async function codexThreadNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const text = await readFile(join(CODEX_HOME, 'session_index.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const o = JSON.parse(line);
        if (o.id && o.thread_name) names.set(o.id, o.thread_name);
      } catch {}
    }
  } catch {}
  return names;
}

/** Reads only the bytes appended since the last pass and parses complete lines. */
async function importFile(path: string, agent: Agent, limits: { value?: CodexRateLimits }): Promise<boolean> {
  const { size } = await stat(path);
  let row = store.getFile(path);
  if (row && size < row.offset) {
    // The file was rewritten; drop what it contributed and start over.
    store.resetFile(path);
    row = undefined;
  }
  if (row && size === row.offset) return false;

  const file: FileRow = row ?? { path, session_key: null, size: 0, offset: 0, state: '{}' };
  const state = JSON.parse(file.state);
  const batch = new Batch();
  const ctx: ParseContext = {
    batch,
    state,
    onSession(key) {
      if (file.session_key === key) return;
      file.session_key = key;
      // A Codex session moved to the archive shows up under a new path.
      for (const other of store.otherFilesForSession(key, path)) {
        if (!existsSync(other)) store.resetFile(other);
      }
    },
  };

  const fh = await open(path, 'r');
  try {
    let pos = file.offset;
    let carry = Buffer.alloc(0);
    const buf = Buffer.alloc(CHUNK);
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const lastNl = data.lastIndexOf(0x0a);
      if (lastNl === -1) {
        carry = Buffer.from(data);
        continue;
      }
      for (const line of data.subarray(0, lastNl).toString('utf8').split('\n')) {
        if (!line) continue;
        try {
          if (agent === 'claude') parseClaudeLine(line, ctx);
          else parseCodexLine(line, ctx, limits);
        } catch {
          // Skip malformed lines; the transcript format is not a stable API.
        }
      }
      carry = Buffer.from(data.subarray(lastNl + 1));
      // Keep the event loop responsive during large first imports.
      await new Promise((r) => setImmediate(r));
    }
    // Only complete lines count as consumed; a partial last line is re-read next pass.
    file.offset = pos - carry.length;
  } finally {
    await fh.close();
  }

  file.size = size;
  file.state = JSON.stringify(state);
  store.commit(file, batch.buckets.values(), batch.sessions.values());
  return true;
}

let running: Promise<ImportSummary> | null = null;

export interface ImportSummary {
  files: number;
  changed: number;
  ms: number;
}

async function scan(): Promise<ImportSummary> {
  const started = Date.now();
  const limits: { value?: CodexRateLimits } = { value: store.getKv<CodexRateLimits>('codex.rateLimits') };
  const before = limits.value?.at;

  const claudeFiles = await listJsonl(CLAUDE_DIR);
  const codexFiles = (await Promise.all(CODEX_DIRS.map(listJsonl))).flat();

  let changed = 0;
  for (const [files, agent] of [[claudeFiles, 'claude'], [codexFiles, 'codex']] as const) {
    for (const f of files) {
      try {
        if (await importFile(f, agent, limits)) changed++;
      } catch (e) {
        console.warn(`[importer] ${f}: ${(e as Error).message}`);
      }
    }
  }

  if (limits.value && limits.value.at !== before) {
    store.setKv('codex.rateLimits', limits.value);
    alertLimits('codex', limits.value);
  }

  // Thread names are user-set, so they outrank generated titles.
  const names = await codexThreadNames();
  if (names.size) {
    const batch = new Batch();
    for (const [id, title] of names) batch.session({ key: `codex:${id}`, agent: 'codex', sessionId: id, title, titleRank: 3 });
    store.commitSessionsOnly(batch.sessions.values());
  }

  store.setKv('importer.lastScan', { at: new Date().toISOString() });
  return { files: claudeFiles.length + codexFiles.length, changed, ms: Date.now() - started };
}

/** Runs one import pass; concurrent callers share the pass in flight. */
export function importNow(): Promise<ImportSummary> {
  running ??= scan().finally(() => {
    running = null;
  });
  return running;
}

export function startImporter(onChange: () => void) {
  const run = () =>
    importNow()
      .then((s) => {
        if (s.changed) {
          console.log(`[importer] ${s.changed}/${s.files} transcripts updated in ${s.ms}ms`);
          onChange();
        }
      })
      .catch((e) => console.error('[importer]', e));
  run();
  setInterval(run, RESCAN_MS).unref();
}
