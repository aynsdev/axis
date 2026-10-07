import { forwardRef, useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { AgentKind, PrChecks, PrState, PullRequest, TaskStatus } from '@axis/shared';
import { cn } from '@/lib/cn';

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-line bg-surface text-fg hover:bg-hover',
  ghost: 'text-fg-secondary hover:bg-hover hover:text-fg',
  danger: 'border border-line bg-surface text-error hover:bg-error-bg',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-small',
  md: 'h-10 px-4 text-body',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export function Button({ variant, size, loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ label, className, ...props }: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-hover hover:text-fg [&_svg]:size-[18px]',
        className,
      )}
      {...props}
    />
  );
}

// ---------- Surfaces ----------

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border border-line-subtle bg-surface', className)} {...props} />;
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-subtle text-fg-muted">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-medium text-fg">{title}</p>
        {description && <p className="max-w-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-line bg-error-bg px-3 py-2 text-error">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

// ---------- Page layout (pedi-layout) ----------

export function Page({
  title,
  description,
  actions,
  width = 'full',
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  width?: 'full' | 'narrow';
  children: ReactNode;
}) {
  return (
    <div
      data-slot="page"
      className={cn(
        'flex flex-1 flex-col gap-8 p-4 sm:px-8 sm:py-8',
        width === 'narrow' ? 'mx-auto w-full max-w-2xl' : 'mx-auto w-full max-w-[1280px]',
      )}
    >
      {(title !== undefined || actions !== undefined) && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            {title !== undefined && <h1 className="text-h1 font-semibold tracking-[-0.02em]">{title}</h1>}
            {description && <p className="text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function PageSection({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {(title !== undefined || actions !== undefined) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {title !== undefined && <h2 className="text-h4 font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- Status ----------

const STATUS: Record<TaskStatus, { label: string; icon: LucideIcon; className: string; spin?: boolean }> = {
  queued: { label: 'Queued', icon: Clock, className: 'text-fg-secondary bg-subtle' },
  running: { label: 'Running', icon: Loader2, className: 'text-info bg-info-bg', spin: true },
  succeeded: { label: 'Succeeded', icon: CheckCircle2, className: 'text-success bg-success-bg' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-error bg-error-bg' },
  cancelled: { label: 'Cancelled', icon: Ban, className: 'text-fg-muted bg-subtle' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS[status] ?? { label: status, icon: CircleDashed, className: 'text-fg-muted bg-subtle' };
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-small font-medium', s.className)}>
      <Icon className={cn('size-3.5', s.spin && 'animate-spin')} aria-hidden />
      {s.label}
    </span>
  );
}

export function AgentBadge({ agent }: { agent: AgentKind }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-line px-2 text-small font-medium text-fg-secondary">
      {agent === 'claude' ? 'Claude' : 'Codex'}
    </span>
  );
}

// ---------- Forms ----------

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-fg">
        {label}
      </label>
      {children({ id, 'aria-describedby': hint || error ? hintId : undefined, 'aria-invalid': error ? true : undefined })}
      {(error || hint) && (
        <p id={hintId} className={cn('text-small', error ? 'text-error' : 'text-fg-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

const controlClass =
  'w-full rounded-lg border border-line bg-subtle px-3 text-fg placeholder:text-fg-placeholder transition-colors hover:border-fg-disabled focus-visible:outline-2 focus-visible:outline-offset-0 aria-invalid:border-error';

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlClass, 'h-10', className)} {...props} />
));

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlClass, 'min-h-40 resize-y py-2.5 leading-[22px]', className)} {...props} />
));

export const Select = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(controlClass, 'h-10 pr-8', className)} {...props} />
));

/** Segmented choice built on radio inputs, so it is keyboard-accessible by default. */
export function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
  legend,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; description?: string }>;
  legend: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-medium text-fg">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring',
              value === o.value ? 'border-fg bg-subtle' : 'border-line hover:bg-hover',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="flex items-center gap-2 font-medium text-fg">
              <span
                aria-hidden
                className={cn(
                  'size-3.5 rounded-full border',
                  value === o.value ? 'border-[5px] border-fg' : 'border-line',
                )}
              />
              {o.label}
            </span>
            {o.description && <span className="pl-5.5 text-small text-fg-muted">{o.description}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-subtle px-1.5 font-mono text-[11px] text-fg-muted">{children}</kbd>;
}

/** Compact single-choice control for filters (range, agent, metric). */
export function ToggleGroup<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-md px-3 text-small font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const AGENT_FILTERS = [
  { value: 'all', label: 'All agents' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
] as const;

export const RANGE_FILTERS = [
  { value: 1, label: 'Today' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
] as const;

// ---------- Pull requests ----------

const PR_STATE: Record<PrState, { label: string; icon: LucideIcon; className: string }> = {
  open: { label: 'Open', icon: GitPullRequest, className: 'text-success bg-success-bg' },
  draft: { label: 'Draft', icon: GitPullRequestDraft, className: 'text-fg-secondary bg-subtle' },
  merged: { label: 'Merged', icon: GitMerge, className: 'text-info bg-info-bg' },
  closed: { label: 'Closed', icon: GitPullRequestClosed, className: 'text-error bg-error-bg' },
};

export function PrBadge({ pr, compact }: { pr: PullRequest; compact?: boolean }) {
  const s = PR_STATE[pr.state];
  const Icon = s.icon;
  return (
    <span
      className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-small font-medium tabular-nums', s.className)}
      title={`PR #${pr.number} · ${s.label}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {compact ? `#${pr.number}` : `#${pr.number} · ${s.label}`}
    </span>
  );
}

const CHECKS: Record<PrChecks, { label: string; icon: LucideIcon; className: string } | null> = {
  passing: { label: 'Checks passing', icon: CheckCircle2, className: 'text-success' },
  failing: { label: 'Checks failing', icon: XCircle, className: 'text-error' },
  pending: { label: 'Checks running', icon: Clock, className: 'text-warning' },
  none: null,
};

export function ChecksLabel({ checks }: { checks: PrChecks }) {
  const c = CHECKS[checks];
  if (!c) return <span className="text-fg-muted">No checks</span>;
  const Icon = c.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5', c.className)}>
      <Icon className="size-4" aria-hidden />
      {c.label}
    </span>
  );
}

// ---------- Dialog ----------

/** Modal built on <dialog>, so focus trapping and Escape come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-line bg-surface p-0 text-fg-secondary shadow-[var(--shadow-overlay)] backdrop:bg-black/60"
    >
      {open && (
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="dialog-title" className="text-h4 font-semibold">
              {title}
            </h2>
            {description && <p className="text-fg-muted">{description}</p>}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Checkbox({ label, description, ...props }: Omit<ComponentProps<'input'>, 'type'> & { label: string; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-text-primary)] disabled:opacity-50" {...props} />
      <label htmlFor={id} className={cn('flex flex-col gap-0.5', props.disabled && 'opacity-60')}>
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="text-small text-fg-muted">{description}</span>}
      </label>
    </div>
  );
}

export function PriorityChip({ priority }: { priority: 'high' | 'normal' | 'low' }) {
  if (priority === 'normal') return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold uppercase tracking-wide',
        priority === 'high' ? 'bg-fg text-canvas' : 'border border-line text-fg-muted',
      )}
    >
      {priority}
    </span>
  );
}
