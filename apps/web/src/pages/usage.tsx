import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { AgentFilter, RateLimitWindow, UsageReport } from '@aynshq/shared';
import { BarChart } from '@/components/bar-chart';
import { StatTile } from '@/components/stat';
import { AGENT_FILTERS, Button, Card, ErrorNote, Page, PageSection, RANGE_FILTERS, ToggleGroup } from '@/components/ui';
import { api, qk } from '@/lib/api';
import { cn } from '@/lib/cn';
import { billableTokens, formatRelative, formatTokens, formatUsd } from '@/lib/format';
import { useNow } from '@/lib/use-now';

type Metric = 'tokens' | 'cost';

const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);

function windowName(w: RateLimitWindow) {
  if (w.windowMinutes === 300) return '5-hour window';
  if (w.windowMinutes === 10080) return 'Weekly';
  if (w.windowMinutes % 1440 === 0) return `${w.windowMinutes / 1440}-day window`;
  if (w.windowMinutes % 60 === 0) return `${w.windowMinutes / 60}-hour window`;
  return `${w.windowMinutes}-minute window`;
}

function Meter({ w, now }: { w: RateLimitWindow; now: number }) {
  const pct = Math.max(0, Math.min(100, w.usedPercent));
  const level = pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok';
  const resets = w.resetsAt ? w.resetsAt * 1000 : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-fg">{windowName(w)}</span>
        <span className="flex items-center gap-1.5 tabular-nums text-fg">
          {level !== 'ok' && <AlertTriangle className={cn('size-3.5', level === 'critical' ? 'text-error' : 'text-warning')} aria-hidden />}
          <span className="font-semibold">{Math.round(pct)}%</span>
          <span className="text-fg-muted">used</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${windowName(w)} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-2 overflow-hidden rounded-full bg-active"
      >
        <div
          className={cn('h-full rounded-full', level === 'critical' ? 'bg-error' : level === 'warning' ? 'bg-warning' : 'bg-fg-secondary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-small text-fg-muted">
        {resets && resets > now ? `Resets ${formatRelative(new Date(resets).toISOString(), now)}` : 'Window has reset since the last reading'}
      </span>
    </div>
  );
}

function CodexLimits({ limits }: { limits: NonNullable<UsageReport['codexLimits']> }) {
  const now = useNow(60_000);
  return (
    <PageSection title="Codex plan limits">
      <Card className="flex flex-col gap-5 p-5">
        <div className="grid gap-6 sm:grid-cols-2">
          {limits.windows.map((w) => (
            <Meter key={w.label} w={w} now={now} />
          ))}
        </div>
        <p className="text-small text-fg-muted">
          {limits.plan ? `${limits.plan[0].toUpperCase()}${limits.plan.slice(1)} plan · ` : ''}
          As of your last Codex turn, {formatRelative(limits.at, now)}.
        </p>
      </Card>
    </PageSection>
  );
}

function Breakdown({
  rows,
  label,
}: {
  label: string;
  rows: Array<{ key: string; name: string; sub?: string; sessions: number; tokens: number; cached: number; cost: number | null }>;
}) {
  return (
    <Card>
      <table className="w-full text-left tabular-nums">
        <thead>
          <tr className="border-b border-line-subtle text-small text-fg-muted">
            <th className="px-4 py-2.5 font-medium">{label}</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Sessions</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">Tokens</th>
            <th className="hidden w-px whitespace-nowrap px-4 py-2.5 text-right font-medium sm:table-cell">Cache reads</th>
            <th className="w-px whitespace-nowrap px-4 py-2.5 text-right font-medium">API cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line-subtle last:border-0">
              <td className="max-w-0 px-4 py-3">
                <span className="block truncate font-medium text-fg" title={r.sub ?? r.name}>
                  {r.name}
                </span>
                {r.sub && <span className="block truncate text-small text-fg-muted">{r.sub}</span>}
              </td>
              <td className="px-4 py-3 text-right">{r.sessions}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right">{formatTokens(r.tokens)}</td>
              <td className="hidden whitespace-nowrap px-4 py-3 text-right text-fg-muted sm:table-cell">{formatTokens(r.cached)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right">{r.cost === null ? '—' : formatUsd(r.cost)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-fg-muted">
                No usage in this range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

export function UsagePage() {
  const [days, setDays] = useState<number>(30);
  const [agent, setAgent] = useState<AgentFilter>('all');
  const [metric, setMetric] = useState<Metric>('tokens');
  const [showTable, setShowTable] = useState(false);
  const usage = useQuery({ queryKey: qk.usage(days, agent), queryFn: () => api.usage(days, agent) });
  const rescan = useMutation({ mutationFn: api.rescan, onSuccess: () => usage.refetch() });
  const now = useNow(60_000);
  const r = usage.data;
  const t = r?.totals;
  const costMetric = metric === 'cost' && agent !== 'codex';
  const format = costMetric ? (n: number) => formatUsd(n) : formatTokens;

  return (
    <Page
      title="Usage"
      description={
        <>
          From local Claude Code and Codex transcripts.{' '}
          {r?.lastScanAt && <span>Updated {formatRelative(r.lastScanAt, now)}.</span>}
        </>
      }
      actions={
        <Button variant="secondary" size="sm" onClick={() => rescan.mutate()} loading={rescan.isPending}>
          {!rescan.isPending && <RefreshCw aria-hidden />} Rescan
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup label="Agent" value={agent} onChange={setAgent} options={[...AGENT_FILTERS]} />
        <ToggleGroup label="Date range" value={days} onChange={setDays} options={[...RANGE_FILTERS]} />
      </div>

      {usage.error && <ErrorNote>{(usage.error as Error).message}</ErrorNote>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Tokens" value={t ? formatTokens(billableTokens(t)) : '–'} detail="Input, cache writes and output" />
        <StatTile label="Cache reads" value={t ? formatTokens(t.cached) : '–'} detail="Reused context, billed at a discount" />
        <StatTile
          label="API-equivalent cost"
          value={t ? (agent === 'codex' ? '—' : formatUsd(t.costUsd)) : '–'}
          detail="Claude at list prices; not your subscription bill"
        />
        <StatTile label="Sessions" value={t?.sessions ?? '–'} detail={r && `${r.byAgent.map((a) => `${a.sessions} ${a.agent === 'claude' ? 'Claude' : 'Codex'}`).join(' · ') || 'none'}`} />
      </div>

      {r?.codexLimits && agent !== 'claude' && r.codexLimits.windows.length > 0 && <CodexLimits limits={r.codexLimits} />}

      {days > 1 && (
        <PageSection
          title={costMetric ? 'API-equivalent cost per day' : 'Tokens per day'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {agent !== 'codex' && (
                <ToggleGroup
                  label="Metric"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: 'tokens', label: 'Tokens' },
                    { value: 'cost', label: 'Cost' },
                  ]}
                />
              )}
              <button
                onClick={() => setShowTable(!showTable)}
                className="h-8 rounded-lg px-3 text-small font-medium text-fg-muted hover:bg-hover hover:text-fg"
              >
                {showTable ? 'Show chart' : 'Show table'}
              </button>
            </div>
          }
        >
          <Card className="p-4 sm:p-5">
            {!r ? (
              <div className="h-[220px]" />
            ) : showTable ? (
              <table className="w-full text-left tabular-nums">
                <thead>
                  <tr className="border-b border-line-subtle text-small text-fg-muted">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Sessions</th>
                    <th className="py-2 text-right font-medium">Tokens</th>
                    <th className="hidden py-2 text-right font-medium sm:table-cell">Cache reads</th>
                    <th className="py-2 text-right font-medium">API cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.days].reverse().map((d) => (
                    <tr key={d.date} className="border-b border-line-subtle last:border-0">
                      <td className="py-2">{dayLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                      <td className="py-2 text-right">{d.sessions}</td>
                      <td className="py-2 text-right">{formatTokens(billableTokens(d))}</td>
                      <td className="hidden py-2 text-right text-fg-muted sm:table-cell">{formatTokens(d.cached)}</td>
                      <td className="py-2 text-right">{agent === 'codex' ? '—' : formatUsd(d.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <BarChart
                label={`${costMetric ? 'API-equivalent cost' : 'Tokens'} per day, last ${days} days`}
                format={format}
                bars={r.days.map((d) => ({
                  key: d.date,
                  label: dayLabel(d.date, { month: 'short', day: 'numeric' }),
                  title: `${dayLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`,
                  value: costMetric ? d.costUsd : billableTokens(d),
                }))}
              />
            )}
          </Card>
        </PageSection>
      )}

      <div className="grid gap-8 xl:grid-cols-2">
        <PageSection title="By model">
          <Breakdown
            label="Model"
            rows={(r?.byModel ?? []).map((m) => ({
              key: `${m.agent}:${m.model}`,
              name: m.model.replace(/^claude-/, ''),
              sub: m.agent === 'claude' ? 'Claude Code' : 'Codex',
              sessions: m.sessions,
              tokens: billableTokens(m),
              cached: m.cached,
              cost: m.agent === 'codex' ? null : m.costUsd,
            }))}
          />
        </PageSection>
        <PageSection title="By project">
          <Breakdown
            label="Project"
            rows={(r?.byProject ?? []).map((p) => ({
              key: p.cwd,
              name: p.project,
              sub: p.cwd.replace(/^\/Users\/[^/]+/, '~'),
              sessions: p.sessions,
              tokens: billableTokens(p),
              cached: p.cached,
              cost: p.priced ? p.costUsd : null,
            }))}
          />
        </PageSection>
      </div>
    </Page>
  );
}
