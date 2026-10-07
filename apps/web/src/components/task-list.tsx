import { Link } from '@tanstack/react-router';
import type { Task } from '@aynshq/shared';
import { formatDuration, formatRelative, formatTokens, formatUsd } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { AgentBadge, PrBadge, PriorityChip, StatusBadge } from './ui';

/** Responsive task list: a table on wide screens, stacked rows on phones. */
export function TaskList({ tasks }: { tasks: Task[] }) {
  const now = useNow(tasks.some((t) => t.status === 'running') ? 1000 : 30_000);
  return (
    <>
      <table className="hidden w-full text-left md:table">
        <thead>
          <tr className="border-b border-line-subtle text-small text-fg-muted">
            <th className="px-4 py-2.5 font-medium">Task</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 font-medium">Status</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 font-medium">Agent</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Tokens</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Cost</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="group relative border-b border-line-subtle last:border-0 hover:bg-hover">
              <td className="max-w-0 px-4 py-3">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: t.id }}
                  className="block truncate font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
                >
                  {t.title}
                </Link>
                <span className="flex min-w-0 items-center gap-1.5 text-small text-fg-muted">
                  <PriorityChip priority={t.priority} />
                  <span className="truncate">
                    {t.repoName} · {formatRelative(t.createdAt, now)}
                  </span>
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={t.status} />
                  {t.pr && <PrBadge pr={t.pr} compact />}
                </span>
              </td>
              <td className="px-4 py-3">
                <AgentBadge agent={t.agent} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                {formatTokens(t.usage.inputTokens + t.usage.cachedInputTokens + t.usage.outputTokens)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatUsd(t.usage.costUsd)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-fg-muted">{formatDuration(t.startedAt, t.finishedAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line-subtle md:hidden">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="flex flex-col gap-2 px-4 py-3 hover:bg-hover">
              <span className="line-clamp-2 font-medium text-fg">{t.title}</span>
              <span className="flex flex-wrap items-center gap-2 text-small text-fg-muted">
                <StatusBadge status={t.status} />
                <PriorityChip priority={t.priority} />
                {t.pr && <PrBadge pr={t.pr} compact />}
                <AgentBadge agent={t.agent} />
                <span>{t.repoName}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{formatDuration(t.startedAt, t.finishedAt, now)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
