import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileDiff,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Task, TaskEvent, TaskEventKind, TaskPriority } from '@aynshq/shared';
import {
  AgentBadge,
  Button,
  buttonClass,
  Card,
  Checkbox,
  ChecksLabel,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Page,
  PageSection,
  PrBadge,
  StatusBadge,
  Textarea,
  ToggleGroup,
} from '@/components/ui';
import { api, qk } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatDuration, formatTokens, formatUsd } from '@/lib/format';
import { useNow } from '@/lib/use-now';

const isActive = (t: Task) => t.status === 'running' || t.status === 'queued';

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const task = useQuery({ queryKey: qk.task(taskId), queryFn: () => api.task(taskId) });
  const [tab, setTab] = useState<'activity' | 'changes' | 'prompt'>('activity');

  const onTask = (t: Task) => qc.setQueryData(qk.task(t.id), t);
  const cancel = useMutation({ mutationFn: () => api.cancelTask(taskId), onSuccess: onTask });
  const retry = useMutation({
    mutationFn: () => api.retryTask(taskId),
    onSuccess: (t) => navigate({ to: '/tasks/$taskId', params: { taskId: t.id } }),
  });
  const removeWt = useMutation({ mutationFn: () => api.removeWorktree(taskId), onSuccess: onTask });
  const [prOpen, setPrOpen] = useState(false);
  const finished = !!task.data && !isActive(task.data);
  // Only finished tasks with commits can be turned into a PR.
  const diff = useQuery({
    queryKey: [...qk.diff(taskId), task.data?.status],
    queryFn: () => api.diff(taskId),
    enabled: finished && !task.data?.pr,
  });
  const canOpenPr = finished && !task.data?.pr && (diff.data?.commitsAhead ?? 0) > 0;

  if (task.isLoading) return <Page><p className="text-fg-muted">Loading task…</p></Page>;
  if (!task.data) {
    return (
      <Page>
        <Card>
          <EmptyState icon={AlertTriangle} title="Task not found" description={(task.error as Error)?.message} />
        </Card>
      </Page>
    );
  }

  const t = task.data;
  const mutationError = (cancel.error ?? retry.error ?? removeWt.error) as Error | null;

  return (
    <Page
      title={<span className="line-clamp-2 break-words">{t.title}</span>}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          <AgentBadge agent={t.agent} />
          <span>
            {t.repoName} · <span className="font-mono text-small">{t.branch}</span>
          </span>
        </span>
      }
      actions={
        <>
          {isActive(t) ? (
            <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              <Square aria-hidden /> Cancel task
            </Button>
          ) : (
            <>
              {t.worktreePath && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm('Remove the worktree folder? The branch is kept.')) removeWt.mutate();
                  }}
                  loading={removeWt.isPending}
                >
                  <Trash2 aria-hidden /> Remove worktree
                </Button>
              )}
              <Button variant={canOpenPr ? 'secondary' : 'primary'} onClick={() => retry.mutate()} loading={retry.isPending}>
                <RotateCcw aria-hidden /> Run again
              </Button>
              {canOpenPr && (
                <Button variant="primary" onClick={() => setPrOpen(true)}>
                  <GitPullRequest aria-hidden /> Open PR
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <Link to="/tasks" className="-mt-4 inline-flex w-fit items-center gap-1.5 text-small text-fg-muted hover:text-fg">
        <ArrowLeft className="size-3.5" aria-hidden /> All tasks
      </Link>

      {mutationError && <ErrorNote>{mutationError.message}</ErrorNote>}
      {t.status === 'failed' && t.error && <ErrorNote>{t.error}</ErrorNote>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {t.summary && !isActive(t) && (
            <Card className="flex flex-col gap-2 p-5">
              <span className="text-small font-medium text-fg-muted">Final message</span>
              <p className="whitespace-pre-wrap break-words text-fg">{t.summary}</p>
            </Card>
          )}

          <div role="tablist" aria-label="Task views" className="flex gap-1 border-b border-line-subtle">
            {(
              [
                ['activity', 'Activity', Terminal],
                ['changes', 'Changes', FileDiff],
                ['prompt', 'Prompt', MessageSquare],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  '-mb-px flex h-10 items-center gap-2 border-b-2 px-3 font-medium transition-colors',
                  tab === id ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {tab === 'activity' && <ActivityLog task={t} />}
          {tab === 'changes' && <Changes task={t} />}
          {tab === 'prompt' && (
            <Card className="p-5">
              <p className="whitespace-pre-wrap break-words font-mono text-small text-fg">{t.prompt}</p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--header-height)+2rem)]">
          {t.pr && <PrCard task={t} />}
          <Details task={t} />
        </div>
      </div>

      <OpenPrDialog task={t} open={prOpen} onClose={() => setPrOpen(false)} />
    </Page>
  );
}

// ---------- pull request ----------

function PrCard({ task }: { task: Task }) {
  const qc = useQueryClient();
  const pr = task.pr!;
  const refresh = useMutation({
    mutationFn: () => api.refreshPr(task.id),
    onSuccess: (t) => qc.setQueryData(qk.task(t.id), t),
  });
  const review = pr.review?.toLowerCase().replace(/_/g, ' ');
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-small font-medium text-fg-muted">Pull request</span>
        <PrBadge pr={pr} />
      </div>
      <div className="flex flex-col gap-1.5">
        <ChecksLabel checks={pr.checks} />
        {review && <span className="text-fg-secondary first-letter:uppercase">Review: {review}</span>}
      </div>
      {refresh.error && <ErrorNote>{(refresh.error as Error).message}</ErrorNote>}
      <div className="flex gap-2">
        <a href={pr.url} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm', 'flex-1')}>
          View on GitHub <ExternalLink aria-hidden />
        </a>
        <Button variant="ghost" size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending} aria-label="Refresh PR status">
          {!refresh.isPending && <RefreshCw aria-hidden />}
        </Button>
      </div>
    </Card>
  );
}

function OpenPrDialog({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const gh = useQuery({ queryKey: qk.github, queryFn: api.github, enabled: open, staleTime: 60_000 });
  const remote = useQuery({ queryKey: qk.repoRemote(task.repoId), queryFn: () => api.repoRemote(task.repoId), enabled: open });
  const create = useMutation({
    mutationFn: () => api.openPr(task.id, { title, body: body || undefined, draft }),
    onSuccess: (t) => {
      qc.setQueryData(qk.task(t.id), t);
      onClose();
    },
  });

  const blocker = !gh.data
    ? null
    : !gh.data.installed
      ? 'The GitHub CLI (gh) is not installed.'
      : !gh.data.authenticated
        ? 'The GitHub CLI is not logged in. Run `gh auth login` in a terminal.'
        : remote.data && !remote.data.url
          ? `${task.repoName} has no "origin" remote to push to.`
          : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Open pull request"
      description={
        <>
          Pushes <span className="font-mono text-small text-fg">{task.branch}</span> to origin and opens a PR into{' '}
          <span className="font-mono text-small text-fg">{task.baseBranch}</span>
          {gh.data?.user && <> as {gh.data.user}</>}.
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={256} required />}</Field>
        <Field label="Description" hint="Leave empty to use the agent's final message, the prompt and the diff stat.">
          {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-28" />}
        </Field>
        <Checkbox label="Open as draft" checked={draft} onChange={(e) => setDraft(e.target.checked)} />

        {blocker && <ErrorNote>{blocker}</ErrorNote>}
        {create.error && <ErrorNote>{(create.error as Error).message}</ErrorNote>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!!blocker || !gh.data || !title.trim()}>
            <GitPullRequest aria-hidden /> {draft ? 'Open draft PR' : 'Open PR'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- details sidebar ----------

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="group flex w-full min-w-0 items-center gap-1.5 rounded text-left font-mono text-small text-fg hover:text-fg-secondary"
      aria-label={`Copy ${value}`}
    >
      <span className="min-w-0 truncate">{value}</span>
      {copied ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <Copy className="size-3.5 shrink-0 text-fg-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-small text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function PriorityControl({ task }: { task: Task }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (p: TaskPriority) => api.setPriority(task.id, p),
    onSuccess: (t) => qc.setQueryData(qk.task(t.id), t),
  });
  return (
    <div className="flex flex-col gap-1.5">
      <ToggleGroup
        label="Priority"
        value={task.priority}
        onChange={(p) => set.mutate(p)}
        options={[
          { value: 'high', label: 'High' },
          { value: 'normal', label: 'Normal' },
          { value: 'low', label: 'Low' },
        ]}
      />
      {set.error && <span className="text-small text-error">{(set.error as Error).message}</span>}
    </div>
  );
}

function Details({ task: t }: { task: Task }) {
  const now = useNow(t.status === 'running' ? 1000 : 60_000);
  const u = t.usage;
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="grid grid-cols-2 gap-4">
        <Row label="Tokens">
          <span className="text-h4 font-semibold tabular-nums">{formatTokens(u.inputTokens + u.cachedInputTokens + u.outputTokens)}</span>
        </Row>
        <Row label="Cost">
          <span className="text-h4 font-semibold tabular-nums">{formatUsd(u.costUsd)}</span>
        </Row>
      </div>
      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-subtle p-3 text-small tabular-nums">
        <Row label="Input">{formatTokens(u.inputTokens)}</Row>
        <Row label="Cached">{formatTokens(u.cachedInputTokens)}</Row>
        <Row label="Output">{formatTokens(u.outputTokens)}</Row>
      </dl>
      <dl className="flex flex-col gap-3.5">
        <Row label="Duration">
          <span className="tabular-nums">{formatDuration(t.startedAt, t.finishedAt, now)}</span>
        </Row>
        <Row label="Created">{formatDateTime(t.createdAt)}</Row>
        <Row label="Model">{t.model ?? 'Agent default'}</Row>
        <Row label="Priority">
          {t.status === 'queued' ? <PriorityControl task={t} /> : <span className="first-letter:uppercase">{t.priority}</span>}
        </Row>
        <Row label="Permissions">{t.permission === 'full' ? 'Full access' : 'Edit files'}</Row>
        {t.autoPr && !t.pr && <Row label="Pull request">Opens a draft PR on success</Row>}
        <Row label="Base branch">
          <span className="font-mono text-small">{t.baseBranch}</span>
        </Row>
        <Row label="Branch">
          <CopyValue value={t.branch} />
        </Row>
        {t.worktreePath && (
          <Row label="Worktree">
            <CopyValue value={t.worktreePath} />
          </Row>
        )}
        {t.sessionId && (
          <Row label="Session">
            <CopyValue value={t.sessionId} />
          </Row>
        )}
      </dl>
    </Card>
  );
}

// ---------- activity ----------

const EVENT_STYLE: Record<TaskEventKind, { icon: LucideIcon; label: string; className: string }> = {
  system: { icon: ChevronRight, label: 'System', className: 'text-fg-muted' },
  message: { icon: MessageSquare, label: 'Agent', className: 'text-fg' },
  tool: { icon: Wrench, label: 'Tool', className: 'text-fg-secondary' },
  tool_result: { icon: Terminal, label: 'Output', className: 'text-fg-muted' },
  stderr: { icon: Terminal, label: 'stderr', className: 'text-fg-muted' },
  error: { icon: AlertTriangle, label: 'Error', className: 'text-error' },
  result: { icon: Check, label: 'Result', className: 'text-success' },
};

function EventRow({ e }: { e: TaskEvent }) {
  const s = EVENT_STYLE[e.kind];
  const Icon = s.icon;
  const isOutput = e.kind === 'tool_result' || e.kind === 'stderr';
  const [open, setOpen] = useState(false);
  const long = isOutput && e.text.split('\n').length > 6;
  const time = new Date(e.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 py-2">
      <Icon className={cn('mt-0.5 size-4', s.className)} aria-label={s.label} />
      <div className="flex min-w-0 flex-col gap-1">
        {isOutput ? (
          <pre
            className={cn(
              'overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-subtle px-3 py-2 font-mono text-[12px] leading-[18px] text-fg-muted',
              long && !open && 'line-clamp-6',
            )}
          >
            {e.text}
          </pre>
        ) : (
          <p className={cn('whitespace-pre-wrap break-words', s.className, e.kind === 'tool' && 'font-mono text-small')}>{e.text}</p>
        )}
        <span className="flex items-center gap-3 text-[11px] text-fg-placeholder">
          <time dateTime={e.createdAt}>{time}</time>
          {long && (
            <button onClick={() => setOpen(!open)} className="font-medium text-fg-muted hover:text-fg">
              {open ? 'Show less' : 'Show all'}
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function ActivityLog({ task }: { task: Task }) {
  const events = useQuery({ queryKey: qk.events(task.id), queryFn: () => api.events(task.id) });
  const endRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const count = events.data?.length ?? 0;

  // Follow new output while the user is at the bottom of the page.
  useEffect(() => {
    const main = document.getElementById('content');
    if (!main) return;
    const onScroll = () => setFollow(main.scrollHeight - main.scrollTop - main.clientHeight < 120);
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (follow && task.status === 'running') endRef.current?.scrollIntoView({ block: 'end' });
  }, [count, follow, task.status]);

  if (events.isLoading) return <p className="text-fg-muted">Loading activity…</p>;
  if (!count) {
    return (
      <Card>
        <EmptyState
          icon={Terminal}
          title={task.status === 'queued' ? 'Waiting for a free slot' : 'No activity yet'}
          description={task.status === 'queued' ? 'The task starts as soon as a running task finishes.' : undefined}
        />
      </Card>
    );
  }

  return (
    <Card className="px-4 py-2 sm:px-5">
      <ol aria-live={task.status === 'running' ? 'polite' : undefined} aria-label="Activity" className="divide-y divide-line-subtle">
        {events.data!.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </ol>
      {task.status === 'running' && (
        <div className="flex items-center gap-2 py-3 text-small text-fg-muted">
          <span className="size-1.5 animate-pulse rounded-full bg-fg-muted" aria-hidden /> Agent is working…
        </div>
      )}
      <div ref={endRef} />
    </Card>
  );
}

// ---------- changes ----------

function Changes({ task }: { task: Task }) {
  const diff = useQuery({
    queryKey: [...qk.diff(task.id), task.status],
    queryFn: () => api.diff(task.id),
    enabled: task.status !== 'queued',
    refetchInterval: task.status === 'running' ? 5000 : false,
  });

  if (task.status === 'queued') {
    return (
      <Card>
        <EmptyState icon={FileDiff} title="No worktree yet" />
      </Card>
    );
  }
  if (diff.isLoading) return <p className="text-fg-muted">Loading changes…</p>;
  if (diff.error) return <ErrorNote>{(diff.error as Error).message}</ErrorNote>;
  const d = diff.data!;
  if (!d.patch) {
    return (
      <Card>
        <EmptyState
          icon={FileDiff}
          title="No committed changes yet"
          description={task.status === 'running' ? 'Uncommitted work is committed when the task finishes.' : undefined}
        />
      </Card>
    );
  }

  return (
    <PageSection title={`${d.commitsAhead} commit${d.commitsAhead === 1 ? '' : 's'} ahead of ${task.baseBranch}`}>
      <Card className="overflow-hidden">
        <pre className="border-b border-line-subtle bg-subtle px-4 py-3 font-mono text-[12px] leading-[18px] text-fg-secondary">{d.stat}</pre>
        <pre className="overflow-x-auto py-2 font-mono text-[12px] leading-[18px]">
          {d.patch.split('\n').map((line, i) => (
            <div
              key={i}
              className={cn(
                'px-4',
                line.startsWith('+') && !line.startsWith('+++') && 'bg-success-bg text-success',
                line.startsWith('-') && !line.startsWith('---') && 'bg-error-bg text-error',
                line.startsWith('@@') && 'text-info',
                (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) && 'font-semibold text-fg',
                !/^[-+@di]/.test(line) && 'text-fg-muted',
              )}
            >
              {line || ' '}
            </div>
          ))}
        </pre>
      </Card>
    </PageSection>
  );
}
