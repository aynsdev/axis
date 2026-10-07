import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import type { AgentFilter } from '@axis/shared';
import { SessionList } from '@/components/session-list';
import { AGENT_FILTERS, Card, EmptyState, ErrorNote, Page, RANGE_FILTERS, ToggleGroup } from '@/components/ui';
import { api, qk } from '@/lib/api';

export function SessionsPage() {
  const [days, setDays] = useState<number>(7);
  const [agent, setAgent] = useState<AgentFilter>('all');
  const sessions = useQuery({ queryKey: qk.sessions(days, agent), queryFn: () => api.sessions(days, agent, 300) });

  return (
    <Page title="Sessions" description="Every Claude Code and Codex session on this machine, including ones you started in a terminal.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup label="Agent" value={agent} onChange={setAgent} options={[...AGENT_FILTERS]} />
          <ToggleGroup label="Date range" value={days} onChange={setDays} options={[...RANGE_FILTERS]} />
        </div>

        {sessions.error && <ErrorNote>{(sessions.error as Error).message}</ErrorNote>}

        <Card>
          {sessions.isLoading ? (
            <p className="p-6 text-fg-muted">Loading sessions…</p>
          ) : sessions.data?.length ? (
            <SessionList sessions={sessions.data} />
          ) : (
            <EmptyState
              icon={History}
              title="No sessions in this range"
              description="The hub reads transcripts from ~/.claude/projects and ~/.codex/sessions every minute."
            />
          )}
        </Card>
      </div>
    </Page>
  );
}
