import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ListTodo, Plus } from 'lucide-react';
import type { Task } from '@aynshq/shared';
import { TaskList } from '@/components/task-list';
import { buttonClass, Card, EmptyState, ErrorNote, Page } from '@/components/ui';
import { api, qk } from '@/lib/api';
import { cn } from '@/lib/cn';

const FILTERS: Array<{ id: string; label: string; match: (t: Task) => boolean }> = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'active', label: 'Active', match: (t) => t.status === 'running' || t.status === 'queued' },
  { id: 'succeeded', label: 'Succeeded', match: (t) => t.status === 'succeeded' },
  { id: 'failed', label: 'Failed', match: (t) => t.status === 'failed' },
  { id: 'cancelled', label: 'Cancelled', match: (t) => t.status === 'cancelled' },
];

export function TasksPage() {
  const [filter, setFilter] = useState('all');
  const tasks = useQuery({ queryKey: qk.tasks, queryFn: api.tasks });
  const all = tasks.data ?? [];
  const f = FILTERS.find((x) => x.id === filter)!;
  const shown = all.filter(f.match);

  return (
    <Page
      title="Tasks"
      description="Every task the hub has run, newest first."
      actions={
        <Link to="/tasks/new" className={buttonClass('primary')}>
          <Plus aria-hidden /> New task
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Filter tasks" className="flex gap-1 overflow-x-auto">
          {FILTERS.map((x) => {
            const count = all.filter(x.match).length;
            return (
              <button
                key={x.id}
                role="tab"
                aria-selected={filter === x.id}
                onClick={() => setFilter(x.id)}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-small font-medium transition-colors',
                  filter === x.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                {x.label}
                <span className="tabular-nums text-fg-muted">{count}</span>
              </button>
            );
          })}
        </div>

        {tasks.error && <ErrorNote>{(tasks.error as Error).message}</ErrorNote>}

        <Card>
          {tasks.isLoading ? (
            <p className="p-6 text-fg-muted">Loading tasks…</p>
          ) : shown.length ? (
            <TaskList tasks={shown} />
          ) : (
            <EmptyState
              icon={ListTodo}
              title={filter === 'all' ? 'No tasks yet' : `No ${f.label.toLowerCase()} tasks`}
              description={filter === 'all' ? 'Tasks you create here, or later from chat webhooks, show up in this list.' : undefined}
            />
          )}
        </Card>
      </div>
    </Page>
  );
}
