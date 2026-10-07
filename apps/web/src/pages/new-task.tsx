import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, FolderGit2, Play } from 'lucide-react';
import type { AgentKind, PermissionLevel, TaskPriority, Template } from '@axis/shared';
import {
  Button,
  buttonClass,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Kbd,
  Page,
  Segmented,
  Select,
  Textarea,
  ToggleGroup,
} from '@/components/ui';
import { api, qk } from '@/lib/api';

const LAST_KEY = 'axis-last-task';

function readLast(): { repoId?: string; agent?: AgentKind } {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function NewTaskPage() {
  const navigate = useNavigate();
  const repos = useQuery({ queryKey: qk.repos, queryFn: api.repos });
  const last = readLast();

  const [repoId, setRepoId] = useState(last.repoId ?? '');
  const [agent, setAgent] = useState<AgentKind>(last.agent ?? 'claude');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [permission, setPermission] = useState<PermissionLevel>('edits');
  const [autoPr, setAutoPr] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [promptError, setPromptError] = useState<string>();
  const [templateId, setTemplateId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const templates = useQuery({ queryKey: qk.templates, queryFn: api.templates });

  const applyTemplate = (t: Template | undefined) => {
    setTemplateId(t?.id ?? '');
    if (!t) return;
    setPrompt(t.prompt);
    setAgent(t.agent);
    setModel(t.model ?? '');
    setPermission(t.permission);
    setAutoPr(t.autoPr);
    if (t.repoId && repos.data?.some((r) => r.id === t.repoId)) setRepoId(t.repoId);
    setPromptError(undefined);
  };

  const repo = repos.data?.find((r) => r.id === repoId);
  const remote = useQuery({ queryKey: qk.repoRemote(repoId), queryFn: () => api.repoRemote(repoId), enabled: !!repoId });
  const gh = useQuery({ queryKey: qk.github, queryFn: api.github, staleTime: 60_000 });
  const prBlocker = gh.data && !gh.data.authenticated
    ? 'Needs the GitHub CLI logged in (gh auth login).'
    : remote.data && !remote.data.url
      ? `${repo?.name ?? 'This repository'} has no origin remote.`
      : null;

  // Fall back to the first repo when the remembered one is gone.
  useEffect(() => {
    if (repos.data?.length && !repos.data.some((r) => r.id === repoId)) setRepoId(repos.data[0].id);
  }, [repos.data, repoId]);

  const create = useMutation({
    mutationFn: api.createTask,
    onSuccess: (task) => {
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ repoId, agent }));
      } catch {}
      navigate({ to: '/tasks/$taskId', params: { taskId: task.id } });
    },
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim()) return setPromptError('Describe what the agent should do');
    setPromptError(undefined);
    create.mutate({
      repoId,
      agent,
      prompt,
      permission,
      title: title || undefined,
      model: model || undefined,
      baseBranch: baseBranch || undefined,
      autoPr: autoPr && !prBlocker,
      priority,
    });
  };

  if (repos.data && repos.data.length === 0) {
    return (
      <Page title="New task" width="narrow">
        <Card>
          <EmptyState
            icon={FolderGit2}
            title="Add a repository first"
            description="Tasks run in a git worktree of a repository you have registered with the hub."
            action={
              <Link to="/repos" className={buttonClass('primary')}>
                Add repository
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page title="New task" description="The agent works on its own branch in a fresh worktree." width="narrow">
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <Card className="flex flex-col gap-5 p-5 sm:p-6">
          {!!templates.data?.length && (
            <Field label="Start from template" hint="Fills in the prompt, agent and options. You can still edit them.">
              {(p) => (
                <Select {...p} value={templateId} onChange={(e) => applyTemplate(templates.data!.find((t) => t.id === e.target.value))}>
                  <option value="">None</option>
                  {templates.data!.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Repository" hint={repo && `Branches from ${baseBranch || repo.defaultBranch} · ${repo.path}`}>
            {(p) => (
              <Select {...p} value={repoId} onChange={(e) => setRepoId(e.target.value)} disabled={!repos.data}>
                {repos.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Segmented
            legend="Agent"
            name="agent"
            value={agent}
            onChange={setAgent}
            options={[
              { value: 'claude', label: 'Claude Code', description: 'claude -p, headless' },
              { value: 'codex', label: 'Codex', description: 'codex exec' },
            ]}
          />

          <Field label="Prompt" error={promptError} hint="Be specific: what to change, where, and how to verify it.">
            {(p) => (
              <Textarea
                {...p}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                }}
                placeholder="Fix the flaky date test in src/utils/date.test.ts and make sure the suite passes."
                autoFocus
              />
            )}
          </Field>
        </Card>

        <Card className="flex flex-col gap-5 p-5 sm:p-6">
          <h2 className="text-h4 font-semibold">Options</h2>
          <Field label="Title" hint="Defaults to the first line of the prompt.">
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Model" hint={agent === 'claude' ? 'e.g. sonnet, opus, haiku' : 'e.g. gpt-5-codex'}>
              {(p) => <Input {...p} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Agent default" />}
            </Field>
            <Field label="Base branch">
              {(p) => (
                <Input {...p} value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} placeholder={repo?.defaultBranch ?? 'main'} />
              )}
            </Field>
          </div>
          <Segmented
            legend="Permissions"
            name="permission"
            value={permission}
            onChange={setPermission}
            options={[
              { value: 'edits', label: 'Edit files', description: agent === 'claude' ? 'Edits allowed; shell commands blocked' : 'Workspace-write sandbox' },
              { value: 'full', label: 'Full access', description: 'Shell and network without asking' },
            ]}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 font-medium text-fg">Priority</legend>
            <div>
              <ToggleGroup
                label="Priority"
                value={priority}
                onChange={setPriority}
                options={[
                  { value: 'high', label: 'High' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'low', label: 'Low' },
                ]}
              />
            </div>
            <p className="text-small text-fg-muted">When all slots are busy, higher priority tasks start first.</p>
          </fieldset>
          <Checkbox
            label="Open a draft PR when it succeeds"
            description={prBlocker ?? 'Pushes the branch and opens a draft PR. Otherwise you open it from the task page.'}
            checked={autoPr && !prBlocker}
            disabled={!!prBlocker}
            onChange={(e) => setAutoPr(e.target.checked)}
          />
        </Card>

        {create.error && <ErrorNote>{(create.error as Error).message}</ErrorNote>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <span className="hidden text-small text-fg-muted sm:inline">
            <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to start
          </span>
          <Button type="button" variant="ghost" onClick={() => setSaveOpen(true)} disabled={!prompt.trim()}>
            <BookmarkPlus aria-hidden /> Save as template
          </Button>
          <Link to="/tasks" className={buttonClass('secondary')}>
            Cancel
          </Link>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!repoId}>
            <Play aria-hidden /> Start task
          </Button>
        </div>
      </form>

      <SaveTemplateDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        defaultName={title || prompt.split('\n')[0].slice(0, 60)}
        template={{ prompt, agent, model: model || null, permission, autoPr, repoId: repoId || null }}
        onSaved={(t) => setTemplateId(t.id)}
      />
    </Page>
  );
}

function SaveTemplateDialog({
  open,
  onClose,
  defaultName,
  template,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  template: Omit<Template, 'id' | 'createdAt' | 'name'>;
  onSaved: (t: Template) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [includeRepo, setIncludeRepo] = useState(false);
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);
  const save = useMutation({
    mutationFn: () => api.createTemplate({ ...template, name: name.trim(), repoId: includeRepo ? template.repoId : null }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: qk.templates });
      onSaved(t);
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Save as template" description="Saves the prompt, agent, model, permissions and PR option.">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <Field label="Template name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />}</Field>
        <Checkbox label="Also save the repository" checked={includeRepo} onChange={(e) => setIncludeRepo(e.target.checked)} />
        {save.error && <ErrorNote>{(save.error as Error).message}</ErrorNote>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!name.trim()}>
            Save template
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
