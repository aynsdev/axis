import { db } from '../db.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS scan_files (
    path TEXT PRIMARY KEY,
    session_key TEXT,
    size INTEGER NOT NULL,
    offset INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS scan_files_session ON scan_files(session_key);

  CREATE TABLE IF NOT EXISTS local_sessions (
    key TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT,
    title TEXT,
    title_rank INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    origin TEXT,
    first_at TEXT,
    last_at TEXT
  );
  CREATE INDEX IF NOT EXISTS local_sessions_last ON local_sessions(last_at);

  -- Usage per file, session, local day and model. Keyed by file so a rewritten
  -- transcript can be re-imported without double counting.
  CREATE TABLE IF NOT EXISTS usage_buckets (
    file TEXT NOT NULL,
    session_key TEXT NOT NULL,
    date TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT NOT NULL,
    input INTEGER NOT NULL DEFAULT 0,
    cached INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    output INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    turns INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (file, session_key, date, model)
  );
  CREATE INDEX IF NOT EXISTS usage_buckets_date ON usage_buckets(date);
  CREATE INDEX IF NOT EXISTS usage_buckets_session ON usage_buckets(session_key);

  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export interface FileRow {
  path: string;
  session_key: string | null;
  size: number;
  offset: number;
  state: string;
}

export interface Bucket {
  sessionKey: string;
  date: string;
  agent: string;
  model: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  costUsd: number | null;
  turns: number;
}

export interface SessionMeta {
  key: string;
  agent: string;
  sessionId: string;
  cwd?: string;
  title?: string;
  /** Higher rank wins: 1 first prompt, 2 generated title, 3 user-set title. */
  titleRank?: number;
  model?: string;
  origin?: string;
  at?: string;
}

const stmts = {
  getFile: db.prepare('SELECT * FROM scan_files WHERE path = ?'),
  filesForSession: db.prepare('SELECT path FROM scan_files WHERE session_key = ? AND path != ?'),
  saveFile: db.prepare(
    `INSERT INTO scan_files (path, session_key, size, offset, state) VALUES (@path, @session_key, @size, @offset, @state)
     ON CONFLICT(path) DO UPDATE SET session_key = excluded.session_key, size = excluded.size, offset = excluded.offset, state = excluded.state`,
  ),
  deleteFile: db.prepare('DELETE FROM scan_files WHERE path = ?'),
  deleteBuckets: db.prepare('DELETE FROM usage_buckets WHERE file = ?'),
  addBucket: db.prepare(
    `INSERT INTO usage_buckets (file, session_key, date, agent, model, input, cached, cache_write, output, cost_usd, turns)
     VALUES (@file, @sessionKey, @date, @agent, @model, @input, @cached, @cacheWrite, @output, @costUsd, @turns)
     ON CONFLICT(file, session_key, date, model) DO UPDATE SET
       input = input + excluded.input,
       cached = cached + excluded.cached,
       cache_write = cache_write + excluded.cache_write,
       output = output + excluded.output,
       cost_usd = CASE WHEN excluded.cost_usd IS NULL THEN cost_usd ELSE COALESCE(cost_usd, 0) + excluded.cost_usd END,
       turns = turns + excluded.turns`,
  ),
  upsertSession: db.prepare(
    `INSERT INTO local_sessions (key, agent, session_id, cwd, title, title_rank, model, origin, first_at, last_at)
     VALUES (@key, @agent, @sessionId, @cwd, @title, @titleRank, @model, @origin, @at, @at)
     ON CONFLICT(key) DO UPDATE SET
       cwd = COALESCE(local_sessions.cwd, excluded.cwd),
       title = CASE WHEN excluded.title IS NOT NULL AND excluded.title_rank >= local_sessions.title_rank THEN excluded.title ELSE local_sessions.title END,
       title_rank = MAX(local_sessions.title_rank, CASE WHEN excluded.title IS NULL THEN 0 ELSE excluded.title_rank END),
       model = COALESCE(excluded.model, local_sessions.model),
       origin = COALESCE(local_sessions.origin, excluded.origin),
       first_at = CASE WHEN excluded.first_at IS NULL THEN local_sessions.first_at
                       WHEN local_sessions.first_at IS NULL OR excluded.first_at < local_sessions.first_at THEN excluded.first_at
                       ELSE local_sessions.first_at END,
       last_at = CASE WHEN excluded.last_at IS NULL THEN local_sessions.last_at
                      WHEN local_sessions.last_at IS NULL OR excluded.last_at > local_sessions.last_at THEN excluded.last_at
                      ELSE local_sessions.last_at END`,
  ),
  getKv: db.prepare('SELECT value FROM kv WHERE key = ?'),
  setKv: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};

function upsertSessions(sessions: Iterable<SessionMeta>) {
  for (const s of sessions) {
    stmts.upsertSession.run({
      key: s.key,
      agent: s.agent,
      sessionId: s.sessionId,
      cwd: s.cwd ?? null,
      title: s.title ?? null,
      titleRank: s.titleRank ?? 0,
      model: s.model ?? null,
      origin: s.origin ?? null,
      at: s.at ?? null,
    });
  }
}

export const store = {
  getFile: (path: string) => stmts.getFile.get(path) as FileRow | undefined,

  resetFile(path: string) {
    db.transaction(() => {
      stmts.deleteBuckets.run(path);
      stmts.deleteFile.run(path);
    })();
  },

  /** Other files already imported for the same session (e.g. a Codex session moved to the archive). */
  otherFilesForSession: (sessionKey: string, path: string) =>
    (stmts.filesForSession.all(sessionKey, path) as Array<{ path: string }>).map((r) => r.path),

  /** Persists one read pass atomically: usage deltas, session metadata and the new offset. */
  commit(file: FileRow, buckets: Iterable<Bucket>, sessions: Iterable<SessionMeta>) {
    db.transaction(() => {
      for (const b of buckets) stmts.addBucket.run({ file: file.path, ...b });
      upsertSessions(sessions);
      stmts.saveFile.run(file);
    })();
  },

  commitSessionsOnly(sessions: Iterable<SessionMeta>) {
    db.transaction(() => upsertSessions(sessions))();
  },

  getKv<T>(key: string): T | undefined {
    const row = stmts.getKv.get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  setKv: (key: string, value: unknown) => stmts.setKv.run(key, JSON.stringify(value)),
};
