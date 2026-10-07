import { claudeCost, type ClaudeUsage } from './pricing.ts';
import type { Bucket, SessionMeta } from './store.ts';

/** Collects one read pass worth of usage and session metadata. */
export class Batch {
  buckets = new Map<string, Bucket>();
  sessions = new Map<string, SessionMeta>();

  add(b: Omit<Bucket, 'turns'>) {
    const k = `${b.sessionKey}|${b.date}|${b.model}`;
    const cur = this.buckets.get(k);
    if (!cur) {
      this.buckets.set(k, { ...b, turns: 1 });
      return;
    }
    cur.input += b.input;
    cur.cached += b.cached;
    cur.cacheWrite += b.cacheWrite;
    cur.output += b.output;
    cur.turns += 1;
    if (b.costUsd !== null) cur.costUsd = (cur.costUsd ?? 0) + b.costUsd;
  }

  /** Merges metadata; later timestamps and higher-ranked titles win in the store. */
  session(meta: SessionMeta) {
    const cur = this.sessions.get(meta.key);
    if (!cur) {
      this.sessions.set(meta.key, { ...meta });
      return;
    }
    cur.cwd ??= meta.cwd;
    cur.model = meta.model ?? cur.model;
    cur.origin ??= meta.origin;
    if (meta.title && (meta.titleRank ?? 0) >= (cur.titleRank ?? 0)) {
      cur.title = meta.title;
      cur.titleRank = meta.titleRank;
    }
    if (meta.at && (!cur.at || meta.at > cur.at)) cur.at = meta.at;
  }
}

export interface ParseContext {
  batch: Batch;
  /** Per-file parser state, persisted between passes. */
  state: Record<string, any>;
  /** Called when the parser learns which session the file belongs to. */
  onSession(key: string): void;
}

export const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cleanTitle = (s: string) => {
  const line = s.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

const isPromptText = (s: unknown): s is string =>
  typeof s === 'string' && !!s.trim() && !s.trimStart().startsWith('<') && !s.startsWith('Caveat:');

// ---------- Claude Code ----------

/**
 * Claude Code writes one JSONL line per content block, each repeating the
 * message's usage, so usage is counted once per message id.
 */
export function parseClaudeLine(line: string, ctx: ParseContext) {
  const isAssistant = line.includes('"type":"assistant"') && line.includes('"usage"');
  const isTitle = line.includes('"type":"ai-title"') || line.includes('"type":"custom-title"');
  const isUser = !ctx.state.prompted && line.includes('"type":"user"');
  if (!isAssistant && !isTitle && !isUser) return;

  const o = JSON.parse(line);
  const sessionId: string | undefined = o.sessionId ?? ctx.state.sessionId;
  if (!sessionId) return;
  ctx.state.sessionId = sessionId;
  const key = `claude:${sessionId}`;
  ctx.onSession(key);
  const base = { key, agent: 'claude', sessionId };

  if (isTitle) {
    const title = o.customTitle ?? o.title ?? o.aiTitle;
    if (typeof title === 'string' && title.trim()) {
      ctx.batch.session({ ...base, title: cleanTitle(title), titleRank: o.type === 'custom-title' ? 3 : 2 });
    }
    return;
  }

  if (o.type === 'user') {
    const content = o.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.find((c: any) => c?.type === 'text')?.text : undefined;
    if (!o.isMeta && !o.isSidechain && isPromptText(text)) {
      ctx.state.prompted = true;
      ctx.batch.session({ ...base, title: cleanTitle(text), titleRank: 1, cwd: o.cwd, at: o.timestamp, origin: o.entrypoint });
    }
    return;
  }

  if (o.type !== 'assistant') return;
  const msg = o.message ?? {};
  const model: string | undefined = msg.model;
  if (!model || model === '<synthetic>' || !msg.usage || !o.timestamp) return;

  const id = `${msg.id ?? ''}:${o.requestId ?? ''}`;
  const recent: string[] = (ctx.state.recent ??= []);
  if (recent.includes(id)) return;
  recent.push(id);
  if (recent.length > 64) recent.shift();

  const u = msg.usage as ClaudeUsage;
  ctx.batch.add({
    sessionKey: key,
    date: localDate(o.timestamp),
    agent: 'claude',
    model,
    input: u.input_tokens ?? 0,
    cached: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    costUsd: claudeCost(model, u),
  });
  ctx.batch.session({ ...base, cwd: o.cwd, model, at: o.timestamp, origin: o.entrypoint });
}

// ---------- Codex ----------

export interface CodexRateLimits {
  at: string;
  plan: string | null;
  windows: Array<{ label: string; usedPercent: number; windowMinutes: number; resetsAt: number | null }>;
}

/** Codex logs cumulative and per-turn token counts; the per-turn delta is counted when the total moves. */
export function parseCodexLine(line: string, ctx: ParseContext, latestLimits: { value?: CodexRateLimits }) {
  const isMeta = line.includes('"type":"session_meta"');
  const isTurn = line.includes('"type":"turn_context"');
  const isTokens = line.includes('"type":"token_count"');
  const isUser = !ctx.state.prompted && line.includes('"role":"user"');
  if (!isMeta && !isTurn && !isTokens && !isUser) return;

  const o = JSON.parse(line);
  const p = o.payload ?? {};

  if (o.type === 'session_meta') {
    const sessionId = p.id ?? p.session_id;
    if (!sessionId) return;
    ctx.state.sessionId = sessionId;
    ctx.state.cwd = p.cwd;
    const key = `codex:${sessionId}`;
    ctx.onSession(key);
    ctx.batch.session({ key, agent: 'codex', sessionId, cwd: p.cwd, origin: p.originator ?? p.source, at: o.timestamp });
    return;
  }

  const sessionId: string | undefined = ctx.state.sessionId;
  if (!sessionId) return;
  const key = `codex:${sessionId}`;
  const base = { key, agent: 'codex', sessionId };

  if (o.type === 'turn_context') {
    if (typeof p.model === 'string') ctx.state.model = p.model;
    return;
  }

  if (o.type === 'response_item' && p.type === 'message' && p.role === 'user') {
    const text = (p.content ?? []).find((c: any) => c?.type === 'input_text' && isPromptText(c.text))?.text;
    if (text) {
      ctx.state.prompted = true;
      ctx.batch.session({ ...base, title: cleanTitle(text), titleRank: 1 });
    }
    return;
  }

  if (o.type !== 'event_msg' || p.type !== 'token_count') return;

  if (p.rate_limits && o.timestamp && (!latestLimits.value || o.timestamp > latestLimits.value.at)) {
    const rl = p.rate_limits;
    const win = (label: string, w: any) =>
      w && typeof w.used_percent === 'number'
        ? [{ label, usedPercent: w.used_percent, windowMinutes: w.window_minutes ?? 0, resetsAt: w.resets_at ?? null }]
        : [];
    latestLimits.value = { at: o.timestamp, plan: rl.plan_type ?? null, windows: [...win('primary', rl.primary), ...win('secondary', rl.secondary)] };
  }

  const info = p.info;
  const total = info?.total_token_usage?.total_tokens;
  const last = info?.last_token_usage;
  if (!last || typeof total !== 'number' || total === ctx.state.lastTotal) return;
  ctx.state.lastTotal = total;

  const cached = last.cached_input_tokens ?? 0;
  const model: string = ctx.state.model ?? 'codex';
  ctx.batch.add({
    sessionKey: key,
    date: localDate(o.timestamp),
    agent: 'codex',
    model,
    input: Math.max(0, (last.input_tokens ?? 0) - cached),
    cached,
    cacheWrite: last.cache_write_input_tokens ?? 0,
    output: last.output_tokens ?? 0,
    costUsd: null,
  });
  ctx.batch.session({ ...base, model, at: o.timestamp, cwd: ctx.state.cwd });
}
