import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import type { LocalSession } from '@aynshq/shared';
import { billableTokens, formatRelative, formatTokens, formatUsd } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { AgentBadge } from './ui';

const ACTIVE_MS = 5 * 60_000;

export const isRecentlyActive = (s: LocalSession, now = Date.now()) => !!s.lastAt && now - Date.parse(s.lastAt) < ACTIVE_MS;

function ActiveDot({ s, now }: { s: LocalSession; now: number }) {
  if (!isRecentlyActive(s, now)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-success">
      <span className="size-1.5 rounded-full bg-success" aria-hidden />
      Active
    </span>
  );
}

function SessionTitle({ s }: { s: LocalSession }) {
  return (
    <>
      <span className="block truncate font-medium text-fg" title={s.title ?? undefined}>
        {s.title ?? 'Untitled session'}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-small text-fg-muted">
        <span className="truncate" title={s.cwd ?? undefined}>
          {s.project ?? 'unknown project'}
        </span>
        {s.taskId && (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: s.taskId }}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 font-medium text-fg-secondary hover:bg-hover hover:text-fg"
          >
            Hub task <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        )}
      </span>
    </>
  );
}

/** Sessions found in local transcripts, whether started by the hub or by hand. */
export function SessionList({ sessions }: { sessions: LocalSession[] }) {
  const now = useNow(30_000);
  return (
    <>
      <table className="hidden w-full text-left md:table">
        <thead>
          <tr className="border-b border-line-subtle text-small text-fg-muted">
            <th className="px-4 py-2.5 font-medium">Session</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 font-medium">Agent</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 font-medium">Model</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Tokens</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">API cost</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Last active</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.key} className="border-b border-line-subtle last:border-0">
              <td className="max-w-0 px-4 py-3">
                <SessionTitle s={s} />
              </td>
              <td className="px-4 py-3">
                <AgentBadge agent={s.agent} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-small text-fg-secondary">{s.model?.replace(/^claude-/, '') ?? '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums" title={`${formatTokens(s.cached)} cache reads`}>
                {formatTokens(billableTokens(s))}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{s.agent === 'codex' ? '—' : formatUsd(s.costUsd)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-fg-muted">
                {isRecentlyActive(s, now) ? <ActiveDot s={s} now={now} /> : s.lastAt ? formatRelative(s.lastAt, now) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line-subtle md:hidden">
        {sessions.map((s) => (
          <li key={s.key} className="flex flex-col gap-2 px-4 py-3">
            <div className="min-w-0">
              <SessionTitle s={s} />
            </div>
            <span className="flex flex-wrap items-center gap-2 text-small text-fg-muted">
              <AgentBadge agent={s.agent} />
              <span className="tabular-nums">{formatTokens(billableTokens(s))} tokens</span>
              {s.agent === 'claude' && <span className="tabular-nums">{formatUsd(s.costUsd)}</span>}
              <span aria-hidden>·</span>
              {isRecentlyActive(s, now) ? <ActiveDot s={s} now={now} /> : <span>{s.lastAt ? formatRelative(s.lastAt, now) : '—'}</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
