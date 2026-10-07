import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, FileText, Trash2 } from 'lucide-react';
import { NOTIFY_EVENTS, type NotifyEvent, type Settings } from '@aynshq/shared';
import { AgentBadge, Button, buttonClass, Card, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, Page, PageSection } from '@/components/ui';
import { api, qk } from '@/lib/api';

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: qk.settings, queryFn: api.settings });
  const [draft, setDraft] = useState<Settings>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      setDraft(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });
  const test = useMutation({ mutationFn: api.testNotification });

  const dirty = !!draft && !!settings.data && JSON.stringify(draft) !== JSON.stringify(settings.data);
  const setN = (patch: Partial<Settings['notifications']>) => draft && setDraft({ ...draft, notifications: { ...draft.notifications, ...patch } });
  const setEvent = (e: NotifyEvent, on: boolean) =>
    draft && setN({ events: { ...draft.notifications.events, [e]: on } });

  return (
    <Page title="Settings" description="Applies to this hub only." width="narrow">
      {!draft ? (
        <p className="text-fg-muted">Loading settings…</p>
      ) : (
        <>
        <form
          className="flex flex-col gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <PageSection title="Agents">
            <Card className="flex flex-col gap-5 p-5 sm:p-6">
              <Field label="Agents running at once" hint="Queued tasks wait for a free slot. Raising it starts queued tasks right away.">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={16}
                    value={draft.maxConcurrency}
                    onChange={(e) => setDraft({ ...draft, maxConcurrency: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
                    className="max-w-32 tabular-nums"
                  />
                )}
              </Field>
            </Card>
          </PageSection>

          <PageSection
            title="Notifications"
            actions={
              <Button type="button" variant="secondary" size="sm" onClick={() => test.mutate()} loading={test.isPending}>
                {!test.isPending && <BellRing aria-hidden />} Send test
              </Button>
            }
          >
            <Card className="flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-4">
                <Checkbox
                  label="macOS notifications"
                  description="Shown even when the dashboard is closed. Clicking one opens the task or PR. In-app toasts are always on."
                  checked={draft.notifications.desktop}
                  onChange={(e) => setN({ desktop: e.target.checked })}
                />
                <Checkbox
                  label="Play a sound"
                  checked={draft.notifications.sound}
                  disabled={!draft.notifications.desktop}
                  onChange={(e) => setN({ sound: e.target.checked })}
                />
              </div>
              <div className="border-t border-line-subtle pt-5">
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-3 font-medium text-fg">Notify me when</legend>
                {(Object.keys(NOTIFY_EVENTS) as NotifyEvent[]).map((e) => (
                  <Checkbox key={e} label={NOTIFY_EVENTS[e]} checked={draft.notifications.events[e]} onChange={(ev) => setEvent(e, ev.target.checked)} />
                ))}
              </fieldset>
              </div>
              {test.isSuccess && (
                <p className="text-small text-fg-muted">
                  Test sent. If no macOS notification appeared, allow notifications for terminal-notifier (or Script Editor) in System Settings.
                </p>
              )}
            </Card>
          </PageSection>

          {save.error && <ErrorNote>{(save.error as Error).message}</ErrorNote>}

          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-small text-success" role="status">
                <Check className="size-4" aria-hidden /> Saved
              </span>
            )}
            <Button type="button" variant="secondary" disabled={!dirty} onClick={() => setDraft(settings.data)}>
              Reset
            </Button>
            <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
              Save settings
            </Button>
          </div>
        </form>
        <Templates />
        </>
      )}
    </Page>
  );
}

function Templates() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: qk.templates, queryFn: api.templates });
  const remove = useMutation({ mutationFn: api.removeTemplate, onSuccess: () => qc.invalidateQueries({ queryKey: qk.templates }) });

  return (
    <PageSection
      title="Task templates"
      actions={
        <Link to="/tasks/new" className={buttonClass('ghost', 'sm')}>
          Create from New task
        </Link>
      }
    >
      {remove.error && <ErrorNote>{(remove.error as Error).message}</ErrorNote>}
      <Card>
        {templates.data?.length ? (
          <ul className="divide-y divide-line-subtle">
            {templates.data.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">{t.name}</span>
                    <AgentBadge agent={t.agent} />
                  </span>
                  <span className="truncate text-small text-fg-muted">{t.prompt}</span>
                </div>
                <IconButton type="button" label={`Delete template ${t.name}`} onClick={() => remove.mutate(t.id)} className="hover:text-error">
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FileText} title="No templates yet" description="On the New task page, fill in a task and choose Save as template." />
        )}
      </Card>
    </PageSection>
  );
}
