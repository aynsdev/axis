import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Page, PageSection } from '@/components/ui';
import { api, qk } from '@/lib/api';

export function ReposPage() {
  const qc = useQueryClient();
  const repos = useQuery({ queryKey: qk.repos, queryFn: api.repos });
  const [path, setPath] = useState('');

  const add = useMutation({
    mutationFn: api.addRepo,
    onSuccess: () => {
      setPath('');
      qc.invalidateQueries({ queryKey: qk.repos });
    },
  });
  const remove = useMutation({
    mutationFn: api.removeRepo,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.repos }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (path.trim()) add.mutate(path.trim());
  };

  return (
    <Page title="Repositories" description="Agents can only work in repositories registered here.">
      <PageSection title="Add repository">
        <Card className="p-5">
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Local path" hint="Any folder inside a git repository. ~ is expanded." error={add.error ? (add.error as Error).message : undefined}>
                {(p) => (
                  <Input
                    {...p}
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="~/Projects/my-app"
                    className="font-mono"
                    spellCheck={false}
                  />
                )}
              </Field>
            </div>
            <Button type="submit" variant="primary" loading={add.isPending} disabled={!path.trim()} className="sm:mb-6">
              <Plus aria-hidden /> Add
            </Button>
          </form>
        </Card>
      </PageSection>

      <PageSection title="Registered">
        {remove.error && <ErrorNote>{(remove.error as Error).message}</ErrorNote>}
        <Card>
          {repos.data?.length ? (
            <ul className="divide-y divide-line-subtle">
              {repos.data.map((r) => (
                <li key={r.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                  <FolderGit2 className="size-5 shrink-0 text-fg-muted" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-fg">{r.name}</span>
                    <span className="truncate font-mono text-small text-fg-muted">{r.path}</span>
                  </div>
                  <span className="hidden rounded-md border border-line px-2 py-0.5 font-mono text-small text-fg-secondary sm:inline">
                    {r.defaultBranch}
                  </span>
                  <IconButton
                    label={`Remove ${r.name}`}
                    onClick={() => remove.mutate(r.id)}
                    className="hover:text-error"
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={FolderGit2} title="No repositories yet" description="Add a local git repository above to start running tasks." />
          )}
        </Card>
      </PageSection>
    </Page>
  );
}
