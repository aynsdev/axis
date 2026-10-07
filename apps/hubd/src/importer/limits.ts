import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentKind, PlanLimits, RateLimitWindow } from '@axis/shared';
import { notify } from '../notify.ts';
import { store } from './store.ts';

const ALERT_AT = 90;
const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };

/** Notifies once per limit window cycle when usage crosses the threshold. */
export function alertLimits(agent: AgentKind, l: PlanLimits) {
  const key = `${agent}.limitAlerted`;
  const alerted = new Set(store.getKv<string[]>(key) ?? []);
  let changed = false;
  for (const w of l.windows) {
    // Claude reports sub-second reset times; minutes keep the id stable across readings.
    const id = `${w.label}:${w.resetsAt === null ? null : Math.round(w.resetsAt / 60)}`;
    // A reading from a window that has already reset is stale.
    if (w.usedPercent < ALERT_AT || alerted.has(id) || (w.resetsAt && w.resetsAt * 1000 < Date.now())) continue;
    alerted.add(id);
    changed = true;
    const name = w.windowMinutes === 300 ? '5-hour' : w.windowMinutes === 10080 ? 'weekly' : `${Math.round(w.windowMinutes / 60)}-hour`;
    const resets = w.resetsAt ? new Date(w.resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon';
    notify(`${agent}.limit`, {
      title: `${AGENT_NAMES[agent]} ${name}${w.scope ? ` ${w.scope}` : ''} limit at ${Math.round(w.usedPercent)}%`,
      body: `Resets ${resets}`,
      level: 'warning',
      path: '/usage',
    });
  }
  if (changed) store.setKv(key, [...alerted].slice(-20));
}

// ---------- Claude ----------

const POLL_MS = 5 * 60_000;
/** Manual rescans refresh at most this often, to stay gentle with the endpoint. */
const MIN_REFRESH_MS = 60_000;
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const KV_KEY = 'claude.rateLimits';

/** Usage endpoint fields, as Claude Code's `/usage` reads them. */
const WINDOWS = [
  { field: 'five_hour', label: 'session', windowMinutes: 300 },
  { field: 'seven_day', label: 'weekly', windowMinutes: 10080 },
  { field: 'seven_day_opus', label: 'weekly-opus', windowMinutes: 10080, scope: 'Opus' },
  { field: 'seven_day_sonnet', label: 'weekly-sonnet', windowMinutes: 10080, scope: 'Sonnet' },
] as const;

interface ClaudeOAuth {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

class LimitError extends Error {}

function keychain(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) =>
    execFile('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], (err, out) =>
      resolve(err ? null : out.trim() || null),
    ),
  );
}

/** Claude Code keeps its login in the macOS keychain, or in `.credentials.json` elsewhere. */
async function readLogin(): Promise<ClaudeOAuth> {
  let raw = await keychain();
  if (!raw) {
    const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    raw = await readFile(join(dir, '.credentials.json'), 'utf8').catch(() => null);
  }
  const oauth = raw ? (JSON.parse(raw).claudeAiOauth as ClaudeOAuth | undefined) : undefined;
  if (!oauth?.accessToken) throw new LimitError('Sign in to Claude Code with a Claude subscription to see plan limits.');
  // Refreshing here would rotate the token out from under Claude Code, so leave that to it.
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) throw new LimitError('Claude Code login has expired. Run claude to refresh it.');
  return oauth;
}

async function fetchClaudeLimits(): Promise<PlanLimits> {
  const login = await readLogin();
  const res = await fetch(USAGE_URL, {
    headers: { authorization: `Bearer ${login.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new LimitError('Claude rejected the login. Run claude to sign in again.');
  if (!res.ok) throw new LimitError(`Claude usage endpoint returned ${res.status}.`);
  const body = (await res.json()) as Record<string, { utilization?: number; resets_at?: string | null } | null>;
  const windows: RateLimitWindow[] = [];
  for (const { field, ...w } of WINDOWS) {
    const v = body[field];
    if (typeof v?.utilization !== 'number') continue;
    windows.push({ ...w, usedPercent: v.utilization, resetsAt: v.resets_at ? Math.round(Date.parse(v.resets_at) / 1000) : null });
  }
  return { at: new Date().toISOString(), plan: login.subscriptionType ?? null, windows };
}

let inFlight: Promise<boolean> | null = null;

/** Fetches Claude plan limits; resolves true when the stored reading changed. */
export function refreshClaudeLimits(force = false): Promise<boolean> {
  const last = store.getKv<PlanLimits>(KV_KEY);
  if (!force && last && Date.now() - Date.parse(last.at) < MIN_REFRESH_MS) return Promise.resolve(false);
  inFlight ??= fetchClaudeLimits()
    .then((l) => {
      store.setKv(KV_KEY, l);
      alertLimits('claude', l);
      return true;
    })
    .catch((e) => {
      const error = e instanceof LimitError ? e.message : 'Could not reach the Claude usage endpoint.';
      if (!(e instanceof LimitError)) console.warn('[limits] claude:', (e as Error).message);
      // Keep the last good windows so a blip doesn't blank the meters.
      store.setKv(KV_KEY, { at: last?.at ?? new Date().toISOString(), plan: last?.plan ?? null, windows: last?.windows ?? [], error });
      return last?.error !== error;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function startClaudeLimits(onChange: () => void) {
  if (process.env.AXIS_CLAUDE_LIMITS === '0') return;
  const run = () => refreshClaudeLimits(true).then((changed) => changed && onChange());
  run();
  setInterval(run, POLL_MS).unref();
}
