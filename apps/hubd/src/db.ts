import Database from 'better-sqlite3';
import type {
  AgentKind,
  PermissionLevel,
  PullRequest,
  TaskPriority,
  Template,
  TemplateInput,
  Repo,
  Stats,
  Task,
  TaskEvent,
  TaskEventKind,
  TaskSource,
  TaskStatus,
} from '@aynshq/shared';
import { config } from './config.ts';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    default_branch TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    permission TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    repo_id TEXT NOT NULL REFERENCES repos(id),
    base_branch TEXT NOT NULL,
    branch TEXT NOT NULL,
    worktree_path TEXT,
    session_id TEXT,
    pid INTEGER,
    error TEXT,
    summary TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS tasks_created ON tasks(created_at);

  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id, id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    permission TEXT NOT NULL,
    auto_pr INTEGER NOT NULL DEFAULT 0,
    repo_id TEXT,
    created_at TEXT NOT NULL
  );
`);

// Additive migrations for databases created by earlier versions.
const taskColumns = new Set((db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((c) => c.name));
for (const [name, ddl] of [
  ['auto_pr', 'INTEGER NOT NULL DEFAULT 0'],
  ['pr', 'TEXT'],
  ['priority', 'INTEGER NOT NULL DEFAULT 1'],
] as const) {
  if (!taskColumns.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${ddl}`);
}

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

// ---------- repos ----------

interface RepoRow {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  created_at: string;
}

const toRepo = (r: RepoRow): Repo => ({
  id: r.id,
  name: r.name,
  path: r.path,
  defaultBranch: r.default_branch,
  createdAt: r.created_at,
});

export const repos = {
  list(): Repo[] {
    return (db.prepare('SELECT * FROM repos ORDER BY name').all() as RepoRow[]).map(toRepo);
  },
  get(id: string): Repo | undefined {
    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined;
    return row && toRepo(row);
  },
  create(input: { name: string; path: string; defaultBranch: string }): Repo {
    const repo: Repo = { id: newId(), createdAt: now(), ...input };
    db.prepare(
      'INSERT INTO repos (id, name, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(repo.id, repo.name, repo.path, repo.defaultBranch, repo.createdAt);
    return repo;
  },
  remove(id: string): boolean {
    const inUse = db.prepare('SELECT 1 FROM tasks WHERE repo_id = ? LIMIT 1').get(id);
    if (inUse) return false;
    return db.prepare('DELETE FROM repos WHERE id = ?').run(id).changes > 0;
  },
};

// ---------- tasks ----------

interface TaskRow {
  id: string;
  title: string;
  prompt: string;
  agent: AgentKind;
  model: string | null;
  permission: PermissionLevel;
  priority: number;
  status: TaskStatus;
  source: TaskSource;
  repo_id: string;
  repo_name: string;
  base_branch: string;
  branch: string;
  worktree_path: string | null;
  session_id: string | null;
  pid: number | null;
  error: string | null;
  summary: string | null;
  auto_pr: number;
  pr: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2 };
const PRIORITY_NAME: TaskPriority[] = ['low', 'normal', 'high'];

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  agent: r.agent,
  model: r.model,
  permission: r.permission,
  priority: PRIORITY_NAME[r.priority] ?? 'normal',
  status: r.status,
  source: r.source,
  repoId: r.repo_id,
  repoName: r.repo_name,
  baseBranch: r.base_branch,
  branch: r.branch,
  worktreePath: r.worktree_path,
  sessionId: r.session_id,
  pid: r.pid,
  error: r.error,
  summary: r.summary,
  autoPr: !!r.auto_pr,
  pr: r.pr ? (JSON.parse(r.pr) as PullRequest) : null,
  usage: {
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cachedInputTokens: r.cached_input_tokens,
    costUsd: r.cost_usd,
  },
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const TASK_SELECT = 'SELECT t.*, r.name AS repo_name FROM tasks t JOIN repos r ON r.id = t.repo_id';

/** Columns callers may patch, mapped from Task field names. */
const PATCHABLE = {
  status: 'status',
  worktreePath: 'worktree_path',
  sessionId: 'session_id',
  pid: 'pid',
  error: 'error',
  summary: 'summary',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  pr: 'pr',
} as const;

export type TaskPatch = Partial<Pick<Task, keyof typeof PATCHABLE>>;

export const tasks = {
  list(filter: { status?: TaskStatus[]; limit?: number } = {}): Task[] {
    const where = filter.status?.length
      ? `WHERE t.status IN (${filter.status.map(() => '?').join(',')})`
      : '';
    const rows = db
      .prepare(`${TASK_SELECT} ${where} ORDER BY t.created_at DESC LIMIT ?`)
      .all(...(filter.status ?? []), filter.limit ?? 200) as TaskRow[];
    return rows.map(toTask);
  },
  get(id: string): Task | undefined {
    const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
    return row && toTask(row);
  },
  /** Highest priority first, then oldest, so each priority level is FIFO. */
  nextQueued(limit: number): Task[] {
    const rows = db
      .prepare(`${TASK_SELECT} WHERE t.status = 'queued' ORDER BY t.priority DESC, t.created_at ASC LIMIT ?`)
      .all(limit) as TaskRow[];
    return rows.map(toTask);
  },
  create(input: {
    title: string;
    prompt: string;
    agent: AgentKind;
    model: string | null;
    permission: PermissionLevel;
    source: TaskSource;
    repoId: string;
    baseBranch: string;
    autoPr: boolean;
    priority: TaskPriority;
  }): Task {
    const id = newId();
    db.prepare(
      `INSERT INTO tasks (id, title, prompt, agent, model, permission, priority, status, source, repo_id, base_branch, branch, auto_pr, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.title,
      input.prompt,
      input.agent,
      input.model,
      input.permission,
      PRIORITY_RANK[input.priority],
      input.source,
      input.repoId,
      input.baseBranch,
      `hub/${id}`,
      input.autoPr ? 1 : 0,
      now(),
    );
    return this.get(id)!;
  },
  update(id: string, patch: TaskPatch): Task {
    const entries = Object.entries(patch) as Array<[keyof typeof PATCHABLE, unknown]>;
    if (entries.length) {
      const sets = entries.map(([k]) => `${PATCHABLE[k]} = ?`).join(', ');
      const values = entries.map(([k, v]) => (k === 'pr' && v ? JSON.stringify(v) : v));
      db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...values, id);
    }
    return this.get(id)!;
  },
  /** Usage is cumulative across turns, so runners report deltas. */
  addUsage(id: string, u: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; costUsd?: number }) {
    db.prepare(
      `UPDATE tasks SET
         input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ?,
         cached_input_tokens = cached_input_tokens + ?,
         cost_usd = CASE WHEN ? IS NULL THEN cost_usd ELSE COALESCE(cost_usd, 0) + ? END
       WHERE id = ?`,
    ).run(u.inputTokens ?? 0, u.outputTokens ?? 0, u.cachedInputTokens ?? 0, u.costUsd ?? null, u.costUsd ?? 0, id);
  },
  setPriority(id: string, priority: TaskPriority): Task {
    db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(PRIORITY_RANK[priority], id);
    return this.get(id)!;
  },
  /** Tasks whose PR may still change state. */
  withOpenPrs(): Task[] {
    const rows = db
      .prepare(`${TASK_SELECT} WHERE json_extract(t.pr, '$.state') IN ('open', 'draft') ORDER BY t.created_at DESC LIMIT 50`)
      .all() as TaskRow[];
    return rows.map(toTask);
  },
  /** Tasks left running when the hub stopped can't be reattached. */
  failOrphans(): number {
    return db
      .prepare(
        `UPDATE tasks SET status = 'failed', error = 'Hub stopped while the task was running', pid = NULL, finished_at = ?
         WHERE status = 'running'`,
      )
      .run(now()).changes;
  },
};

// ---------- events ----------

export const events = {
  add(taskId: string, kind: TaskEventKind, text: string): TaskEvent {
    const createdAt = now();
    const info = db
      .prepare('INSERT INTO task_events (task_id, kind, text, created_at) VALUES (?, ?, ?, ?)')
      .run(taskId, kind, text, createdAt);
    return { id: Number(info.lastInsertRowid), taskId, kind, text, createdAt };
  },
  list(taskId: string, afterId = 0): TaskEvent[] {
    return (
      db
        .prepare(
          'SELECT id, task_id AS taskId, kind, text, created_at AS createdAt FROM task_events WHERE task_id = ? AND id > ? ORDER BY id',
        )
        .all(taskId, afterId) as TaskEvent[]
    );
  },
};

// ---------- reporting ----------

export function taskStats(): Pick<Stats, 'running' | 'queued' | 'finishedToday' | 'failedToday'> {
  const row = db
    .prepare(
      `SELECT
         SUM(status = 'running') AS running,
         SUM(status = 'queued') AS queued,
         SUM(status IN ('succeeded','failed','cancelled') AND date(finished_at, 'localtime') = date('now', 'localtime')) AS finishedToday,
         SUM(status = 'failed' AND date(finished_at, 'localtime') = date('now', 'localtime')) AS failedToday
       FROM tasks`,
    )
    .get() as Record<string, number | null>;
  return {
    running: row.running ?? 0,
    queued: row.queued ?? 0,
    finishedToday: row.finishedToday ?? 0,
    failedToday: row.failedToday ?? 0,
  };
}

// ---------- templates ----------

interface TemplateRow {
  id: string;
  name: string;
  prompt: string;
  agent: Template['agent'];
  model: string | null;
  permission: PermissionLevel;
  auto_pr: number;
  repo_id: string | null;
  created_at: string;
}

const toTemplate = (r: TemplateRow): Template => ({
  id: r.id,
  name: r.name,
  prompt: r.prompt,
  agent: r.agent,
  model: r.model,
  permission: r.permission,
  autoPr: !!r.auto_pr,
  repoId: r.repo_id,
  createdAt: r.created_at,
});

export const templates = {
  list(): Template[] {
    return (db.prepare('SELECT * FROM templates ORDER BY name COLLATE NOCASE').all() as TemplateRow[]).map(toTemplate);
  },
  get(id: string): Template | undefined {
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
    return row && toTemplate(row);
  },
  create(t: TemplateInput): Template {
    const id = newId();
    db.prepare(
      `INSERT INTO templates (id, name, prompt, agent, model, permission, auto_pr, repo_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, t.name, t.prompt, t.agent, t.model, t.permission, t.autoPr ? 1 : 0, t.repoId, now());
    return this.get(id)!;
  },
  update(id: string, t: TemplateInput): Template | undefined {
    db.prepare(
      `UPDATE templates SET name = ?, prompt = ?, agent = ?, model = ?, permission = ?, auto_pr = ?, repo_id = ? WHERE id = ?`,
    ).run(t.name, t.prompt, t.agent, t.model, t.permission, t.autoPr ? 1 : 0, t.repoId, id);
    return this.get(id);
  },
  remove(id: string): boolean {
    return db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
  },
};

// ---------- key/value ----------

db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

export const kv = {
  get<T>(key: string): T | undefined {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  set(key: string, value: unknown) {
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  },
};
