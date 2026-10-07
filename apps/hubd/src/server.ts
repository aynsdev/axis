import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { z } from 'zod';
import { NOTIFY_EVENTS, type AgentFilter, type NotifyEvent, type Stats, type TaskStatus } from '@aynshq/shared';
import { bus } from './bus.ts';
import { config } from './config.ts';
import { events, repos, taskStats, tasks, templates } from './db.ts';
import { diffAgainstBase, inspectRepo, removeWorktree } from './git.ts';
import { githubStatus, remoteUrl } from './github.ts';
import { importNow } from './importer/index.ts';
import { listSessions, today, usageReport } from './importer/report.ts';
import { openPr, PrError, refreshPr } from './pr.ts';
import { notify } from './notify.ts';
import { cancel, enqueue, tick } from './queue.ts';
import { getSettings, saveSettings } from './settings.ts';

export const app = new Hono();
export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const api = new Hono();

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

// The API can start agents with shell access, so only same-machine pages may call it.
// Host check blocks DNS rebinding; the custom header forces a CORS preflight we never answer,
// so other websites can't POST here even though we bind to localhost.
app.use('*', async (c, next) => {
  if (!LOCAL_HOST.test(c.req.header('host') ?? '')) return c.json({ error: 'Forbidden host' }, 403);
  const origin = c.req.header('origin');
  if (origin && !LOCAL_ORIGIN.test(origin)) return c.json({ error: 'Forbidden origin' }, 403);
  if (c.req.method !== 'GET' && c.req.header('x-aynshq') !== '1') return c.json({ error: 'Missing x-aynshq header' }, 403);
  await next();
});

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: err.issues.map((i) => i.message).join(', ') }, 400);
  if (err instanceof PrError) return c.json({ error: err.message }, err.status);
  console.error('[hubd]', err);
  return c.json({ error: err.message }, 500);
});

// ---------- repos ----------

api.get('/repos', (c) => c.json(repos.list()));

api.post('/repos', async (c) => {
  const { path } = z.object({ path: z.string().min(1, 'Path is required') }).parse(await c.req.json());
  const info = await inspectRepo(path.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
  if (repos.list().some((r) => r.path === info.root)) return c.json({ error: 'Repository already added' }, 409);
  return c.json(repos.create({ name: info.name, path: info.root, defaultBranch: info.defaultBranch }), 201);
});

api.delete('/repos/:id', (c) => {
  if (!repos.get(c.req.param('id'))) return c.json({ error: 'Not found' }, 404);
  if (!repos.remove(c.req.param('id'))) return c.json({ error: 'Repository has tasks and cannot be removed' }, 409);
  return c.body(null, 204);
});

// ---------- tasks ----------

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

api.get('/tasks', (c) => {
  const status = c.req.query('status')?.split(',').filter((s): s is TaskStatus => STATUSES.includes(s as TaskStatus));
  return c.json(tasks.list({ status, limit: Number(c.req.query('limit') ?? 200) }));
});

const createTaskSchema = z.object({
  repoId: z.string().min(1, 'Repository is required'),
  prompt: z.string().trim().min(1, 'Prompt is required'),
  agent: z.enum(['claude', 'codex']),
  title: z.string().trim().max(120).optional(),
  model: z.string().trim().optional(),
  permission: z.enum(['edits', 'full']).default('edits'),
  baseBranch: z.string().trim().optional(),
  autoPr: z.boolean().default(false),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
});

const titleFrom = (prompt: string) => {
  const line = prompt.split('\n').find((l) => l.trim())!.trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
};

api.post('/tasks', async (c) => {
  const input = createTaskSchema.parse(await c.req.json());
  const repo = repos.get(input.repoId);
  if (!repo) return c.json({ error: 'Repository not found' }, 404);
  const task = tasks.create({
    title: input.title || titleFrom(input.prompt),
    prompt: input.prompt,
    agent: input.agent,
    model: input.model || null,
    permission: input.permission,
    source: 'ui',
    repoId: repo.id,
    baseBranch: input.baseBranch || repo.defaultBranch,
    autoPr: input.autoPr,
    priority: input.priority,
  });
  enqueue(task);
  return c.json(task, 201);
});

api.get('/tasks/:id', (c) => {
  const task = tasks.get(c.req.param('id'));
  return task ? c.json(task) : c.json({ error: 'Not found' }, 404);
});

api.get('/tasks/:id/events', (c) => c.json(events.list(c.req.param('id'), Number(c.req.query('after') ?? 0))));

api.patch('/tasks/:id', async (c) => {
  const { priority } = z.object({ priority: z.enum(['high', 'normal', 'low']) }).parse(await c.req.json());
  const task = tasks.get(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (task.status !== 'queued') return c.json({ error: 'Only queued tasks can be reprioritized' }, 409);
  const updated = tasks.setPriority(task.id, priority);
  bus.publish({ type: 'task.updated', task: updated });
  return c.json(updated);
});

api.post('/tasks/:id/cancel', (c) => {
  const task = cancel(c.req.param('id'));
  return task ? c.json(task) : c.json({ error: 'Not found' }, 404);
});

api.post('/tasks/:id/retry', (c) => {
  const prev = tasks.get(c.req.param('id'));
  if (!prev) return c.json({ error: 'Not found' }, 404);
  const task = tasks.create({
    title: prev.title,
    prompt: prev.prompt,
    agent: prev.agent,
    model: prev.model,
    permission: prev.permission,
    source: prev.source,
    repoId: prev.repoId,
    baseBranch: prev.baseBranch,
    autoPr: prev.autoPr,
    priority: prev.priority,
  });
  enqueue(task);
  return c.json(task, 201);
});

api.get('/tasks/:id/diff', async (c) => {
  const task = tasks.get(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (task.worktreePath) return c.json(await diffAgainstBase(task.worktreePath, task.baseBranch));
  // The worktree is gone but the branch lives on in the repo.
  const repo = repos.get(task.repoId);
  if (!repo || task.status === 'queued') return c.json({ stat: '', patch: '', commitsAhead: 0 });
  try {
    return c.json(await diffAgainstBase(repo.path, task.baseBranch, task.branch));
  } catch {
    return c.json({ stat: '', patch: '', commitsAhead: 0 });
  }
});

api.delete('/tasks/:id/worktree', async (c) => {
  const task = tasks.get(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (task.status === 'running') return c.json({ error: 'Cancel the task first' }, 409);
  const repo = repos.get(task.repoId);
  if (task.worktreePath && repo) await removeWorktree(repo.path, task.worktreePath);
  const updated = tasks.update(task.id, { worktreePath: null });
  bus.publish({ type: 'task.updated', task: updated });
  return c.json(updated);
});

// ---------- pull requests ----------

const openPrSchema = z.object({
  title: z.string().trim().max(256).optional(),
  body: z.string().max(60_000).optional(),
  draft: z.boolean().optional(),
});

api.post('/tasks/:id/pr', async (c) => {
  // The body is optional, but a malformed one is an error rather than silently ignored.
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json({ error: 'Request body is not valid JSON' }, 400);
    }
  }
  const input = openPrSchema.parse(raw);
  return c.json(await openPr(c.req.param('id'), input));
});

api.post('/tasks/:id/pr/refresh', async (c) => c.json(await refreshPr(c.req.param('id'))));

api.get('/github', async (c) => c.json(await githubStatus()));

api.get('/repos/:id/remote', async (c) => {
  const repo = repos.get(c.req.param('id'));
  if (!repo) return c.json({ error: 'Not found' }, 404);
  return c.json({ url: await remoteUrl(repo.path) });
});

// ---------- templates ----------

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  prompt: z.string().trim().min(1, 'Prompt is required'),
  agent: z.enum(['claude', 'codex']),
  model: z.string().trim().nullable().transform((v) => v || null),
  permission: z.enum(['edits', 'full']),
  autoPr: z.boolean(),
  repoId: z.string().nullable(),
});

api.get('/templates', (c) => c.json(templates.list()));
api.post('/templates', async (c) => c.json(templates.create(templateSchema.parse(await c.req.json())), 201));
api.put('/templates/:id', async (c) => {
  const t = templates.update(c.req.param('id'), templateSchema.parse(await c.req.json()));
  return t ? c.json(t) : c.json({ error: 'Not found' }, 404);
});
api.delete('/templates/:id', (c) => (templates.remove(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404)));

// ---------- settings & notifications ----------

const eventKeys = Object.keys(NOTIFY_EVENTS) as [NotifyEvent, ...NotifyEvent[]];
const settingsSchema = z.object({
  maxConcurrency: z.number().int().min(1).max(16),
  notifications: z.object({
    desktop: z.boolean(),
    sound: z.boolean(),
    events: z.record(z.enum(eventKeys), z.boolean()),
  }),
});

api.get('/settings', (c) => c.json(getSettings()));
api.put('/settings', async (c) => {
  const next = settingsSchema.parse(await c.req.json());
  const saved = saveSettings({ ...next, notifications: { ...next.notifications, events: { ...getSettings().notifications.events, ...next.notifications.events } } });
  tick(); // A higher limit can start queued tasks right away.
  return c.json(saved);
});

api.post('/notifications/test', (c) => {
  notify('test', { title: 'Test notification', body: 'Notifications from aynshq are working.', level: 'info', path: '/settings' });
  return c.body(null, 204);
});

// ---------- reporting ----------

api.get('/stats', (c) => {
  const t = today();
  return c.json({
    ...taskStats(),
    costTodayUsd: t.costUsd,
    tokensToday: t.tokens,
    maxConcurrency: getSettings().maxConcurrency,
  } satisfies Stats);
});

const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(14),
  agent: z.enum(['all', 'claude', 'codex']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

api.get('/usage', (c) => {
  const { days, agent } = rangeQuery.parse(c.req.query());
  return c.json(usageReport(days, agent as AgentFilter));
});

api.get('/sessions', (c) => {
  const { days, agent, limit } = rangeQuery.parse(c.req.query());
  return c.json(listSessions(days, agent as AgentFilter, limit));
});

api.post('/usage/rescan', async (c) => {
  const summary = await importNow();
  if (summary.changed) bus.publish({ type: 'usage.updated' });
  return c.json(summary);
});

app.route('/api', api);

app.get(
  '/ws',
  upgradeWebSocket(() => {
    let unsubscribe: (() => void) | undefined;
    return {
      onOpen(_evt, ws) {
        unsubscribe = bus.subscribe((msg) => ws.send(JSON.stringify(msg)));
      },
      onClose() {
        unsubscribe?.();
      },
    };
  }),
);
