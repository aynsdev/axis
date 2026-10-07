import type { TeamMember, WorkspaceAgent, WorkspaceSnapshot } from '@axis/shared';
import { accentForType, SESSION_ACCENTS, type DeskStatus } from './palette';

/** One seat in the office: a team member's desk, a hot desk, or a session at the command desks. */
export interface Desk {
  id: string;
  zone: 'team' | 'pool' | 'session';
  name: string;
  role: string;
  accent: string;
  status: DeskStatus;
  activity: string;
  /** Runs at this desk: a team member's sub agent instances, or the session itself. Busiest first. */
  agents: WorkspaceAgent[];
  member?: TeamMember;
}

export interface Office {
  team: Desk[];
  pool: Desk[];
  sessions: Desk[];
}

export const MAX_POOL = 4;
export const MAX_SESSIONS = 4;

const rank = (a: WorkspaceAgent) => (a.status === 'working' ? 0 : a.status === 'idle' ? 1 : 2);
const busiest = (list: WorkspaceAgent[]) => [...list].sort((a, b) => rank(a) - rank(b) || b.lastAt.localeCompare(a.lastAt));

function single(a: WorkspaceAgent, zone: Desk['zone']): Desk {
  return {
    id: a.id,
    zone,
    name: a.name,
    role: zone === 'session' ? a.role : a.role === 'general-purpose' ? 'General' : a.role,
    accent: zone === 'session' ? SESSION_ACCENTS[a.agent] : accentForType(a.role),
    status: a.status,
    activity: a.activity,
    agents: [a],
  };
}

export function officeFor(snap: WorkspaceSnapshot): Office {
  const subs = snap.agents.filter((a) => a.kind === 'sub');
  const known = new Set(snap.team.map((m) => m.type));

  const team = snap.team.map((member): Desk => {
    const runs = busiest(subs.filter((s) => s.role === member.type));
    const lead = runs[0];
    const working = runs.filter((r) => r.status === 'working').length;
    return {
      id: `team:${member.type}`,
      zone: 'team',
      name: member.name,
      role: member.role,
      accent: accentForType(member.type),
      status: lead ? lead.status : 'off',
      activity: lead ? (working > 1 ? `${lead.activity} (+${working - 1} more)` : lead.activity) : 'Available',
      agents: runs,
      member,
    };
  });

  const pool = busiest(subs.filter((s) => !known.has(s.role)))
    .slice(0, MAX_POOL)
    .map((a) => single(a, 'pool'));
  const sessions = snap.agents
    .filter((a) => a.kind === 'main')
    .slice(0, MAX_SESSIONS)
    .map((a) => single(a, 'session'));
  // Two sessions in one repo would share a name plate; number the later ones.
  const seen = new Map<string, number>();
  for (const d of sessions) {
    const n = (seen.get(d.name) ?? 0) + 1;
    seen.set(d.name, n);
    if (n > 1) d.name = `${d.name} ${n}`;
  }
  return { team, pool, sessions };
}

export const allDesks = (o: Office) => [...o.sessions, ...o.team, ...o.pool];
