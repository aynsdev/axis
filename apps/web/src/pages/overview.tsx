import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, Plus } from 'lucide-react';
import { isRecentlyActive, SessionList } from '@/components/session-list';
import { StatTile } from '@/components/stat';
import { TaskList } from '@/components/task-list';
import { buttonClass, Card, EmptyState, Page, PageSection } from '@/components/ui';
import { api, qk } from '@/lib/api';
import { formatTokens, formatUsd } from '@/lib/format';

export function OverviewPage() {
  const stats = useQuery({ queryKey: qk.stats, queryFn: api.stats });
  const tasks = useQuery({ queryKey: qk.tasks, queryFn: api.tasks });
  const sessions = useQuery({ queryKey: qk.sessions(1, 'all'), queryFn: () => api.sessions(1, 'all', 50), refetchInterval: 60_000 });
  // Sessions outside the hub that wrote to their transcript in the last few minutes.
  const elsewhere = (sessions.data ?? []).filter((x) => !x.taskId && isRecentlyActive(x));
  const s = stats.data;
  const all = tasks.data ?? [];
  const active = all.filter((t) => t.status === 'running' || t.status === 'queued');
  const recent = all.filter((t) => t.status !== 'running' && t.status !== 'queued').slice(0, 8);

  return (
    <Page title="Overview" description="What your agents are doing right now.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Running" value={s ? `${s.running}` : '–'} detail={s && `of ${s.maxConcurrency} slots`} />
        <StatTile label="Queued" value={s?.queued ?? '–'} detail="waiting for a slot" />
        <StatTile
          label="Finished today"
          value={s?.finishedToday ?? '–'}
          detail={s && (s.failedToday ? `${s.failedToday} failed` : 'none failed')}
        />
        <StatTile
          label="Tokens today"
          value={s ? formatTokens(s.tokensToday) : '–'}
          detail={s && `${formatUsd(s.costTodayUsd)} Claude API-equivalent`}
        />
      </div>

      <PageSection title="Active">
        <Card>
          {active.length ? (
            <TaskList tasks={active} />
          ) : (
            <EmptyState
              icon={Bot}
              title="No agents running"
              description="Start a task and pick Claude or Codex to work on one of your repositories."
              action={
                <Link to="/tasks/new" className={buttonClass('primary', 'md')}>
                  <Plus aria-hidden /> New task
                </Link>
              }
            />
          )}
        </Card>
      </PageSection>

      {elsewhere.length > 0 && (
        <PageSection
          title="Active outside the hub"
          actions={
            <Link to="/sessions" className={buttonClass('ghost', 'sm')}>
              All sessions <ArrowRight aria-hidden />
            </Link>
          }
        >
          <Card>
            <SessionList sessions={elsewhere} />
          </Card>
        </PageSection>
      )}

      {recent.length > 0 && (
        <PageSection
          title="Recent"
          actions={
            <Link to="/tasks" className={buttonClass('ghost', 'sm')}>
              All tasks <ArrowRight aria-hidden />
            </Link>
          }
        >
          <Card>
            <TaskList tasks={recent} />
          </Card>
        </PageSection>
      )}
    </Page>
  );
}
