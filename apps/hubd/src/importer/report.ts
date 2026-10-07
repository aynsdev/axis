import { basename } from 'node:path';
import type { AgentFilter, LocalSession, UsageReport } from '@axis/shared';
import { db } from '../db.ts';
import { localDate } from './parsers.ts';
import { store } from './store.ts';

const SUMS = `SUM(b.input) AS input, SUM(b.cached) AS cached, SUM(b.cache_write) AS cacheWrite,
              SUM(b.output) AS output, COALESCE(SUM(b.cost_usd), 0) AS costUsd`;

function since(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return localDate(d.toISOString());
}

function where(days: number, agent: AgentFilter) {
  return {
    sql: `b.date >= ? ${agent === 'all' ? '' : 'AND b.agent = ?'}`,
    params: agent === 'all' ? [since(days)] : [since(days), agent],
  };
}

const zero = { input: 0, cached: 0, cacheWrite: 0, output: 0, costUsd: 0 };

export function usageReport(days: number, agent: AgentFilter): UsageReport {
  const w = where(days, agent);
  const q = <T>(sql: string) => db.prepare(sql).all(...w.params) as T[];

  const rows = q<UsageReport['days'][number]>(
    `SELECT b.date AS date, ${SUMS}, COUNT(DISTINCT b.session_key) AS sessions
     FROM usage_buckets b WHERE ${w.sql} GROUP BY b.date`,
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const filled: UsageReport['days'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDate(d.toISOString());
    filled.push(byDate.get(key) ?? { date: key, ...zero, sessions: 0 });
  }

  const totals = db
    .prepare(`SELECT ${SUMS}, COUNT(DISTINCT b.session_key) AS sessions FROM usage_buckets b WHERE ${w.sql}`)
    .get(...w.params) as UsageReport['totals'];

  const byAgent = q<UsageReport['byAgent'][number]>(
    `SELECT b.agent AS agent, ${SUMS}, COUNT(DISTINCT b.session_key) AS sessions
     FROM usage_buckets b WHERE ${w.sql} GROUP BY b.agent ORDER BY b.agent`,
  );

  const byModel = q<UsageReport['byModel'][number]>(
    `SELECT b.agent AS agent, b.model AS model, ${SUMS}, COUNT(DISTINCT b.session_key) AS sessions
     FROM usage_buckets b WHERE ${w.sql} GROUP BY b.agent, b.model
     ORDER BY SUM(b.input + b.cache_write + b.output) DESC`,
  );

  const byProject = q<Omit<UsageReport['byProject'][number], 'project'>>(
    `SELECT COALESCE(s.cwd, '(unknown)') AS cwd, ${SUMS}, COUNT(DISTINCT b.session_key) AS sessions,
            MAX(b.agent = 'claude') AS priced
     FROM usage_buckets b LEFT JOIN local_sessions s ON s.key = b.session_key
     WHERE ${w.sql} GROUP BY 1 ORDER BY SUM(b.input + b.cache_write + b.output) DESC LIMIT 25`,
  ).map((r) => ({ ...r, priced: !!r.priced, project: basename(r.cwd) }));

  return {
    days: filled,
    totals: { ...zero, sessions: 0, ...stripNulls(totals) },
    byAgent,
    byModel,
    byProject,
    claudeLimits: store.getKv('claude.rateLimits') ?? null,
    codexLimits: store.getKv('codex.rateLimits') ?? null,
    lastScanAt: store.getKv<{ at: string }>('importer.lastScan')?.at ?? null,
  };
}

function stripNulls<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Partial<T>;
}

export function listSessions(days: number, agent: AgentFilter, limit: number): LocalSession[] {
  const w = where(days, agent);
  const rows = db
    .prepare(
      `SELECT s.key, s.agent, s.session_id AS sessionId, s.title, s.cwd, s.model, s.origin,
              s.first_at AS firstAt, s.last_at AS lastAt, ${SUMS}, SUM(b.turns) AS turns,
              (SELECT t.id FROM tasks t WHERE t.session_id = s.session_id LIMIT 1) AS taskId
       FROM usage_buckets b JOIN local_sessions s ON s.key = b.session_key
       WHERE ${w.sql}
       GROUP BY s.key ORDER BY s.last_at DESC LIMIT ?`,
    )
    .all(...w.params, limit) as Omit<LocalSession, 'project'>[];
  return rows.map((r) => ({ ...r, project: r.cwd ? basename(r.cwd) : null }));
}

/** Today's tokens (excluding cache reads) and API-equivalent spend across all local sessions. */
export function today(): { tokens: number; costUsd: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(input + cache_write + output), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM usage_buckets WHERE date = ?`,
    )
    .get(localDate(new Date().toISOString())) as { tokens: number; costUsd: number };
  return row;
}
