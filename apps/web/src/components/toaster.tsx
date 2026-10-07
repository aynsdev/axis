import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import type { HubNotification } from '@axis/shared';
import { cn } from '@/lib/cn';
import { toasts, useToasts } from '@/lib/toasts';

const LEVEL: Record<HubNotification['level'], { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success' },
  error: { icon: XCircle, className: 'text-error' },
  warning: { icon: AlertTriangle, className: 'text-warning' },
  info: { icon: Info, className: 'text-info' },
};

export function Toaster() {
  const items = useToasts();
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:bottom-6"
    >
      {items.map((n) => {
        const l = LEVEL[n.level];
        const Icon = l.icon;
        return (
          <div
            key={n.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-overlay)] motion-safe:animate-[toast-in_160ms_ease-out]"
          >
            <Icon className={cn('mt-0.5 size-5 shrink-0', l.className)} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-medium text-fg">{n.title}</p>
              {n.body && <p className="line-clamp-2 break-words text-small text-fg-muted">{n.body}</p>}
              {(n.path || n.url) && (
                <div className="mt-1 flex gap-3 text-small font-medium">
                  {n.path && (
                    <Link to={n.path} onClick={() => toasts.dismiss(n.id)} className="text-fg hover:underline">
                      View
                    </Link>
                  )}
                  {n.url && (
                    <a href={n.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-secondary hover:text-fg hover:underline">
                      Open PR <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => toasts.dismiss(n.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
