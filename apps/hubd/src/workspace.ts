import { watch, existsSync, type FSWatcher } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import type { AgentKind, TeamMember, WorkerStatus, WorkspaceActivity, WorkspaceAgent, WorkspaceSnapshot } from '@axis/shared';
import { bus } from './bus.ts';
import { db } from './db.ts';

const HOME = homedir();
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? join(HOME, '.claude');
const CLAUDE_DIR = process.env.AXIS_CLAUDE_PROJECTS ?? join(CLAUDE_HOME, 'projects');
const CODEX_DIR = join(process.env.CODEX_HOME ?? join(HOME, '.codex'), 'sessions');

const TICK_MS = 2_000;
const RELIST_MS = 60_000;
/** Sessions untouched for this long leave the workspace. */
const SHOW_MS = 30 * 60_000;
/** A finished sub agent stays at its desk this long. */
const DONE_SHOW_MS = 5 * 60_000;
/** A turn with no new lines for this long has probably stopped. */
const STALE_MS = 10 * 60_000;
/** Enough tail to cover the last few turns without reading whole transcripts. */
const TAIL_BYTES = 256 * 1024;
const RECENT = 8;

type FileKind = 'claude' | 'claude-sub' | 'codex';

interface Parsed {
  status: 'working' | 'finished';
  activity: string;
  recent: WorkspaceActivity[];
  model: string | null;
  cwd: string | null;
  startedAt: string | null;
  lastAt: string | null;
}

interface Watched {
  kind: FileKind;
  path: string;
  sessionId: string;
  agentId?: string;
  size: number;
  mtimeMs: number;
  parsed?: Parsed;
  meta?: { agentType?: string; description?: string };
}

const files = new Map<string, Watched>();

function classify(path: string): Omit<Watched, 'size' | 'mtimeMs'> | null {
  if (!path.endsWith('.jsonl')) return null;
  if (path.startsWith(CODEX_DIR)) {
    const id = basename(path, '.jsonl').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)?.[0];
    return id ? { kind: 'codex', path, sessionId: id } : null;
  }
  if (!path.startsWith(CLAUDE_DIR)) return null;
  const parts = path.slice(CLAUDE_DIR.length + 1).split(sep);
  // <project>/<session>.jsonl
  if (parts.length === 2) return { kind: 'claude', path, sessionId: basename(parts[1], '.jsonl') };
  // <project>/<session>/subagents/agent-<id>.jsonl
  if (parts.length === 4 && parts[2] === 'subagents' && parts[3].startsWith('agent-')) {
    return { kind: 'claude-sub', path, sessionId: parts[1], agentId: basename(parts[3], '.jsonl').slice('agent-'.length) };
  }
  return null;
}

async function track(path: string) {
  const c = classify(path);
  if (!c) return;
  const s = await stat(path).catch(() => null);
  if (!s || Date.now() - s.mtimeMs > SHOW_MS) return;
  if (!files.has(path)) files.set(path, { ...c, size: -1, mtimeMs: 0 });
}

async function relist() {
  for (const dir of [CLAUDE_DIR, CODEX_DIR]) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => track(join(e.parentPath, e.name))));
  }
}

async function readTail(path: string, size: number): Promise<string[]> {
  const fh = await open(path, 'r');
  try {
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // partial first line
    return lines.filter(Boolean);
  } finally {
    await fh.close();
  }
}

async function readHead(path: string, bytes = 64 * 1024): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

// ---------- Describing activity ----------

const clip = (s: string, n = 64) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const file = (p: unknown) => (typeof p === 'string' && p ? basename(p) : 'a file');

function describeClaudeTool(name: string, input: any = {}): string {
  switch (name) {
    case 'Read':
      return `Reading ${file(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file(input.file_path ?? input.notebook_path)}`;
    case 'Write':
      return `Writing ${file(input.file_path)}`;
    case 'Bash':
      return input.description ? clip(sentence(input.description)) : `Running ${clip(String(input.command ?? 'a command'), 40)}`;
    case 'Grep':
      return input.pattern ? `Searching for “${clip(String(input.pattern), 32)}”` : 'Searching the code';
    case 'Glob':
      return input.pattern ? `Finding ${clip(String(input.pattern), 40)}` : 'Finding files';
    case 'WebSearch':
      return input.query ? `Researching “${clip(String(input.query), 36)}”` : 'Searching the web';
    case 'WebFetch':
      try {
        return `Reading ${new URL(input.url).hostname}`;
      } catch {
        return 'Reading a web page';
      }
    case 'Agent':
    case 'Task':
      return `Delegating: ${clip(String(input.description ?? input.subagent_type ?? 'a sub agent'), 48)}`;
    case 'TodoWrite':
      return 'Planning next steps';
    case 'Skill':
      return `Using the ${input.skill ?? 'a'} skill`;
    case 'AskUserQuestion':
      return 'Asking you a question';
    case 'ExitPlanMode':
      return 'Waiting for plan approval';
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return `Using ${mcp[2].replace(/[_-]/g, ' ')}`;
  return `Using ${name}`;
}

function parseClaude(lines: string[]): Parsed {
  const p: Parsed = { status: 'working', activity: 'Starting up', recent: [], model: null, cwd: null, startedAt: null, lastAt: null };
  for (const line of lines) {
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const at: string | undefined = o.timestamp;
    if (at) {
      p.startedAt ??= at;
      p.lastAt = at;
    }
    if (o.cwd) p.cwd = o.cwd;
    const m = o.message ?? {};
    const content = m.content;

    if (o.type === 'assistant') {
      if (m.model && m.model !== '<synthetic>') p.model = m.model;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === 'tool_use') {
          p.status = 'working';
          p.activity = describeClaudeTool(c.name, c.input);
          if (at) p.recent.push({ at, text: p.activity });
        } else if (c?.type === 'thinking') {
          p.status = 'working';
          p.activity = 'Thinking…';
        } else if (c?.type === 'text' && c.text?.trim()) {
          // A reply with no tool call after it ends the turn.
          p.status = 'finished';
          p.activity = 'Replied';
        }
      }
      continue;
    }

    // A prompt or tool results: the model is up next.
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.find((c: any) => c?.type === 'text')?.text : undefined;
    if (typeof text === 'string' && text.startsWith('[Request interrupted')) {
      p.status = 'finished';
      p.activity = 'Interrupted';
      continue;
    }
    if (o.isMeta || (typeof text === 'string' && text.startsWith('<'))) continue;
    p.status = 'working';
    p.activity = 'Thinking…';
  }
  p.recent = p.recent.slice(-RECENT);
  return p;
}

function codexCommand(raw: string): string | null {
  const m = raw.match(/"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {}
  }
  const arr = raw.match(/"command"\s*:\s*\[((?:[^\]\\]|\\.)*)\]/);
  if (arr) {
    try {
      const parts: string[] = JSON.parse(`[${arr[1]}]`);
      return parts.at(-1) ?? null;
    } catch {}
  }
  return null;
}

function describeCodexCall(name: string, args: string): string {
  try {
    const title = JSON.parse(args)?.title;
    if (typeof title === 'string' && title) return clip(title);
  } catch {}
  const cmd = codexCommand(args);
  if (cmd) {
    const first = cmd.trim().split(/\s+/)[0] ?? '';
    if (/^(sed|cat|head|tail|nl|less)$/.test(first)) return 'Reading files';
    if (/^(rg|grep|find|fd|ls)$/.test(first)) return 'Searching the code';
    if (first === 'apply_patch' || cmd.includes('apply_patch')) return 'Editing files';
    return `Running ${clip(cmd, 40)}`;
  }
  if (name === 'apply_patch') return 'Editing files';
  return `Using ${name.replace(/[_-]/g, ' ')}`;
}

function parseCodex(lines: string[]): Parsed {
  const p: Parsed = { status: 'finished', activity: 'Waiting for you', recent: [], model: null, cwd: null, startedAt: null, lastAt: null };
  for (const line of lines) {
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const at: string | undefined = o.timestamp;
    const pl = o.payload ?? {};
    if (at && (o.type === 'response_item' || o.type === 'event_msg')) {
      p.startedAt ??= at;
      p.lastAt = at;
    }
    if (o.type === 'turn_context') {
      if (pl.model) p.model = pl.model;
      if (pl.cwd) p.cwd = pl.cwd;
    } else if (o.type === 'session_meta') {
      if (pl.cwd) p.cwd = pl.cwd;
    } else if (o.type === 'event_msg') {
      if (pl.type === 'task_started') {
        p.status = 'working';
        p.activity = 'Thinking…';
      } else if (pl.type === 'task_complete' || pl.type === 'turn_aborted') {
        p.status = 'finished';
        p.activity = pl.type === 'turn_aborted' ? 'Interrupted' : 'Replied';
      }
    } else if (o.type === 'response_item') {
      if (pl.type === 'custom_tool_call' || pl.type === 'function_call' || pl.type === 'local_shell_call') {
        p.status = 'working';
        p.activity = describeCodexCall(pl.name ?? 'tool', String(pl.input ?? pl.arguments ?? JSON.stringify(pl.action ?? {})));
        if (at) p.recent.push({ at, text: p.activity });
      } else if (pl.type === 'reasoning' && p.status === 'working') {
        p.activity = 'Thinking…';
      } else if (pl.type === 'message' && pl.role === 'assistant' && p.status === 'working') {
        p.activity = 'Writing a reply';
      }
    }
  }
  p.recent = p.recent.slice(-RECENT);
  return p;
}

// ---------- Names ----------

interface AgentDef {
  type: string;
  persona: string | null;
  summary: string | null;
  model: string | null;
}

const defsCache = new Map<string, { at: number; defs: Map<string, AgentDef> }>();

const unquote = (v: string) => v.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');

/** Custom agents describe themselves as `Zuck. React specialist…`; the first word is the persona. */
async function agentDefs(dir: string): Promise<Map<string, AgentDef>> {
  const hit = defsCache.get(dir);
  if (hit && Date.now() - hit.at < RELIST_MS) return hit.defs;
  const defs = new Map<string, AgentDef>();
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const n of names.filter((n) => n.endsWith('.md')).sort()) {
    const text = await readFile(join(dir, n), 'utf8').catch(() => '');
    const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const type = unquote(front.match(/^name:\s*(.+)$/m)?.[1] ?? basename(n, '.md'));
    const desc = unquote(front.match(/^description:\s*(.+)$/m)?.[1] ?? '');
    const persona = desc.match(/^([A-Z][\w'-]{1,15})\.\s/)?.[1] ?? null;
    // The sentence after the persona says what the agent does.
    const rest = persona ? desc.slice(persona.length + 1).trim() : '';
    const summary = rest ? clip(rest.split(/(?<=\.)\s/)[0].replace(/\s*\(.*$/, '').replace(/\.$/, ''), 44) : null;
    const model = unquote(front.match(/^model:\s*(.+)$/m)?.[1] ?? '') || null;
    defs.set(type, { type, persona, summary, model: model === 'inherit' ? null : model });
  }
  defsCache.set(dir, { at: Date.now(), defs });
  return defs;
}

async function persona(agentType: string, cwd: string | null): Promise<string | null> {
  const dirs = [...(cwd ? [join(cwd, '.claude', 'agents')] : []), join(CLAUDE_HOME, 'agents')];
  for (const d of dirs) {
    const def = (await agentDefs(d)).get(agentType);
    if (def) return def.persona ?? roleLabel(def.type);
  }
  return null;
}

/** Everyone in `~/.claude/agents`, plus agents defined by the repos sessions are working in. */
async function team(cwds: Iterable<string>): Promise<TeamMember[]> {
  const members = new Map<string, TeamMember>();
  const add = (defs: Map<string, AgentDef>, source: TeamMember['source']) => {
    for (const d of defs.values())
      members.set(d.type, { type: d.type, name: d.persona ?? roleLabel(d.type), role: d.summary ?? 'Custom agent', model: d.model, source });
  };
  add(await agentDefs(join(CLAUDE_HOME, 'agents')), 'user');
  for (const cwd of new Set(cwds)) add(await agentDefs(join(cwd, '.claude', 'agents')), 'project');
  return [...members.values()].sort((a, b) => a.type.localeCompare(b.type));
}

const ACRONYMS = new Set(['qa', 'ceo', 'cto', 'ui', 'ux', 'api', 'ios', 'seo']);
const BUILTIN_ROLES: Record<string, string> = { 'general-purpose': 'General', Explore: 'Explorer', Plan: 'Planner', fork: 'Fork' };

function roleLabel(agentType: string) {
  if (BUILTIN_ROLES[agentType]) return BUILTIN_ROLES[agentType];
  const bare = agentType.split(':').at(-1) ?? agentType;
  return bare
    .replace(/-agent$/, '')
    .split(/[-_]/)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w === 'paymongo' ? 'PayMongo' : sentence(w)))
    .join(' ');
}

const roots = new Map<string, string>();

/** The repository an agent works in, not whatever subfolder it wandered into. */
function projectRoot(cwd: string): string {
  let root = roots.get(cwd);
  if (!root) {
    root = cwd;
    for (let d = cwd; d !== dirname(d); d = dirname(d)) {
      if (existsSync(join(d, '.git'))) {
        root = d;
        break;
      }
    }
    roots.set(cwd, root);
  }
  return root;
}

const projectName = (cwd: string) => basename(projectRoot(cwd));

const sessionRow = db.prepare('SELECT title, cwd, model FROM local_sessions WHERE key = ?');
const taskRow = db.prepare('SELECT id, title FROM tasks WHERE session_id = ? LIMIT 1');

// ---------- Snapshot ----------

async function refresh(): Promise<void> {
  await Promise.all(
    [...files.values()].map(async (f) => {
      const s = await stat(f.path).catch(() => null);
      if (!s || Date.now() - s.mtimeMs > SHOW_MS) {
        files.delete(f.path);
        return;
      }
      if (s.size === f.size && s.mtimeMs === f.mtimeMs) return;
      f.size = s.size;
      f.mtimeMs = s.mtimeMs;
      const lines = await readTail(f.path, s.size).catch(() => null);
      if (!lines) return;
      f.parsed = f.kind === 'codex' ? parseCodex(lines) : parseClaude(lines);
      if (f.kind === 'codex' && !f.parsed.cwd) {
        const head = await readHead(f.path).catch(() => '');
        const cwd = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
        if (cwd) f.parsed.cwd = JSON.parse(`"${cwd}"`);
      }
      if (f.kind === 'claude-sub' && !f.meta) {
        const raw = await readFile(f.path.replace(/\.jsonl$/, '.meta.json'), 'utf8').catch(() => null);
        f.meta = raw ? JSON.parse(raw) : {};
      }
    }),
  );
}

function statusOf(p: Parsed, kind: 'main' | 'sub'): { status: WorkerStatus; activity: string } {
  const quiet = p.lastAt ? Date.now() - Date.parse(p.lastAt) : Infinity;
  if (p.status === 'working' && quiet < STALE_MS) return { status: 'working', activity: p.activity };
  if (kind === 'sub') return { status: 'done', activity: 'Done' };
  return { status: 'idle', activity: p.status === 'working' ? 'Idle' : 'Waiting for you' };
}

async function build(): Promise<WorkspaceSnapshot> {
  const now = Date.now();
  const mains = new Map<string, WorkspaceAgent>();
  const subs: WorkspaceAgent[] = [];

  for (const f of files.values()) {
    const p = f.parsed;
    if (!p?.lastAt) continue;
    const agent: AgentKind = f.kind === 'codex' ? 'codex' : 'claude';
    const sessionKey = `${agent}:${f.sessionId}`;
    const row = sessionRow.get(sessionKey) as { title: string | null; cwd: string | null; model: string | null } | undefined;
    const task = taskRow.get(f.sessionId) as { id: string; title: string } | undefined;
    const cwd = p.cwd ?? row?.cwd ?? null;
    const project = cwd ? projectName(cwd) : null;

    if (f.kind === 'claude-sub') {
      const { status, activity } = statusOf(p, 'sub');
      if (status === 'done' && now - Date.parse(p.lastAt) > DONE_SHOW_MS) continue;
      const type = f.meta?.agentType ?? 'general-purpose';
      subs.push({
        id: `${sessionKey}:${f.agentId}`,
        agent,
        kind: 'sub',
        parentId: sessionKey,
        sessionId: f.sessionId,
        name: (await persona(type, cwd)) ?? roleLabel(type),
        role: type,
        title: f.meta?.description ?? null,
        project,
        cwd,
        model: p.model,
        status,
        activity,
        startedAt: p.startedAt,
        lastAt: p.lastAt,
        taskId: task?.id ?? null,
        recent: p.recent,
      });
      continue;
    }

    const { status, activity } = statusOf(p, 'main');
    mains.set(sessionKey, {
      id: sessionKey,
      agent,
      kind: 'main',
      parentId: null,
      sessionId: f.sessionId,
      name: project ?? (agent === 'claude' ? 'Claude' : 'Codex'),
      role: agent === 'claude' ? 'Claude Code' : 'Codex',
      title: task?.title ?? row?.title ?? null,
      project,
      cwd,
      model: p.model ?? row?.model ?? null,
      status,
      activity,
      startedAt: p.startedAt,
      lastAt: p.lastAt,
      taskId: task?.id ?? null,
      recent: p.recent,
    });
  }

  // A sub agent can outlive the turn that started it, so keep its session in the room.
  for (const s of subs) {
    if (mains.has(s.parentId!)) continue;
    mains.set(s.parentId!, {
      ...s,
      id: s.parentId!,
      kind: 'main',
      parentId: null,
      name: s.project ?? 'Claude',
      role: 'Claude Code',
      title: null,
      status: 'idle',
      activity: 'Waiting on sub agents',
      recent: [],
    });
  }

  const order = (a: WorkspaceAgent) => (a.status === 'working' ? 0 : 1);
  const agents = [...mains.values()]
    .sort((a, b) => order(a) - order(b) || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
    .flatMap((m) => [m, ...subs.filter((s) => s.parentId === m.id).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))]);
  const repoDirs = agents.map((a) => a.cwd).filter((c): c is string => !!c).map((c) => projectRoot(c));
  return { at: new Date().toISOString(), agents, team: await team(repoDirs) };
}

let last = '';
let latest: WorkspaceSnapshot = { at: new Date().toISOString(), agents: [], team: [] };
let ticking: Promise<void> | null = null;

function tick(): Promise<void> {
  ticking ??= (async () => {
    await refresh();
    latest = await build();
    const sig = JSON.stringify([latest.agents, latest.team]);
    if (sig !== last) {
      last = sig;
      bus.publish({ type: 'workspace.updated', snapshot: latest });
    }
  })()
    .catch((e) => console.warn('[workspace]', (e as Error).message))
    .finally(() => {
      ticking = null;
    });
  return ticking;
}

export async function workspaceSnapshot(): Promise<WorkspaceSnapshot> {
  await tick();
  return latest;
}

export function startWorkspace() {
  const watchers: FSWatcher[] = [];
  for (const dir of [CLAUDE_DIR, CODEX_DIR]) {
    if (!existsSync(dir)) continue;
    try {
      watchers.push(
        watch(dir, { recursive: true }, (_e, name) => {
          if (name && name.endsWith('.jsonl')) void track(join(dir, name));
          else if (name && name.endsWith('.meta.json')) void track(join(dir, name.replace(/\.meta\.json$/, '.jsonl')));
        }),
      );
    } catch {
      // Without recursive watch support the periodic relist still finds new sessions.
    }
  }
  void relist().then(tick);
  setInterval(() => void relist(), RELIST_MS).unref();
  // Only tail transcripts while someone is looking.
  setInterval(() => bus.listening && void tick(), TICK_MS).unref();
  return () => watchers.forEach((w) => w.close());
}

