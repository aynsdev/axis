import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, CornerDownRight, Crosshair, ExternalLink, Maximize, Minimize, Plus, Users } from 'lucide-react';
import type { WorkspaceAgent, WorkspaceSnapshot } from '@axis/shared';
import { buttonClass, ErrorNote, IconButton } from '@/components/ui';
import { api, qk } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDuration, formatRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { allDesks, officeFor, type Desk, type Office } from '@/workspace/model';
import { accentForType, SESSION_ACCENTS, STATUS_COLORS, type DeskStatus } from '@/workspace/palette';
import type { LabelPos, WorkspaceScene } from '@/workspace/scene';

const STATUS_LABEL: Record<DeskStatus, string> = { working: 'Working', idle: 'Idle', done: 'Done', off: 'Off duty' };

function useNightScene() {
  const read = () => {
    const t = document.documentElement.dataset.theme;
    if (t === 'light') return false;
    if (t === 'dark') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [night, setNight] = useState(read);
  useEffect(() => {
    const update = () => setNight(read());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);
  return night;
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}

/** Fullscreen for one element; `supported` is false where the browser has no Fullscreen API. */
function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = () => setActive(!!document.fullscreenElement && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [ref]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen().catch(() => {});
  }, [ref]);
  return { active, toggle, supported: document.fullscreenEnabled };
}

const shortModel = (m: string | null) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '') : null);
const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');
const agentAccent = (a: WorkspaceAgent) => (a.kind === 'main' ? SESSION_ACCENTS[a.agent] : accentForType(a.role));
const deskOf = (a: WorkspaceAgent): Desk => ({
  id: a.id,
  zone: a.kind === 'main' ? 'session' : 'pool',
  name: a.name,
  role: a.role,
  accent: agentAccent(a),
  status: a.status,
  activity: a.activity,
  agents: [a],
});

/** The desk a running agent sits at: its persona's office, or its own hot desk or session desk. */
function deskIdFor(a: WorkspaceAgent, office: Office) {
  if (a.kind === 'sub' && office.team.some((d) => d.member?.type === a.role)) return `team:${a.role}`;
  return a.id;
}

function StatusDot({ status, className }: { status: DeskStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', status === 'working' && 'motion-safe:animate-pulse', className)}
      style={{ background: STATUS_COLORS[status] }}
    />
  );
}

function StatusChip({ status }: { status: DeskStatus }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-subtle px-2.5 text-small font-medium text-fg-secondary">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', className)} style={{ background: color }} />;
}

/** A floating name plate above a desk, styled after the reference's dark tags. */
function DeskLabel({ desk, compact, selected, onSelect, setRef }: { desk: Desk; compact: boolean; selected: boolean; onSelect: () => void; setRef: (el: HTMLButtonElement | null) => void }) {
  const runs = desk.zone === 'team' ? desk.agents.filter((a) => a.status === 'working').length : 0;
  const small = compact && !selected;
  return (
    <button
      ref={setRef}
      tabIndex={-1}
      onClick={onSelect}
      style={{ visibility: 'hidden' }}
      className={cn(
        'group pointer-events-auto absolute left-0 top-0 flex max-w-60 flex-col gap-0.5 rounded-lg border text-left text-white shadow-lg backdrop-blur-sm will-change-transform',
        selected ? 'z-10 border-white/70 bg-black/85' : 'border-white/10 bg-[#0b0e14]/80 hover:z-10 hover:bg-black/90',
        small ? 'px-2 py-1' : 'px-2.5 py-1.5',
        desk.status === 'off' && !selected && 'opacity-80',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Swatch color={desk.accent} />
        <span className="truncate text-[13px] font-semibold leading-4">{desk.name}</span>
        {runs > 1 && <span className="rounded bg-white/15 px-1 text-[10px] font-semibold leading-4 tabular-nums">×{runs}</span>}
        {small && <StatusDot status={desk.status} className="ml-0.5" />}
      </span>
      <span className={cn('min-w-0 items-center gap-1.5 text-[12px] leading-4 text-white/80', small ? 'hidden group-hover:flex' : 'flex')}>
        <StatusDot status={desk.status} />
        <span className="truncate">{desk.activity}</span>
      </span>
    </button>
  );
}

function RosterRow({ desk, sub, selected, onSelect }: { desk: Desk; sub?: string; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', selected ? 'bg-active' : 'hover:bg-hover')}
      >
        <Swatch color={desk.accent} className="mt-1" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="max-w-[70%] shrink-0 truncate font-medium text-fg">{desk.name}</span>
            <span className="min-w-0 truncate text-small text-fg-muted">{sub ?? desk.role}</span>
          </span>
          <span className={cn('flex min-w-0 items-center gap-1.5 text-small', desk.status === 'off' ? 'text-fg-disabled' : 'text-fg-muted')}>
            <StatusDot status={desk.status} />
            <span className="sr-only">{STATUS_LABEL[desk.status]}:</span>
            <span className="truncate">{desk.activity}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h2 className="flex items-center justify-between px-2.5 pb-1 pt-3 text-small font-medium text-fg-muted">
        {title}
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="min-w-0 truncate text-fg-secondary">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Recent({ agent, now }: { agent: WorkspaceAgent; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-small font-medium text-fg-muted">Recent activity</h3>
      {agent.recent.length ? (
        <ol className="flex flex-col gap-1.5">
          {[...agent.recent].reverse().map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex items-baseline justify-between gap-3 text-small">
              <span className="min-w-0 truncate text-fg-secondary">{r.text}</span>
              <time dateTime={r.at} className="shrink-0 tabular-nums text-fg-disabled">
                {formatRelative(r.at, now)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-small text-fg-muted">No tool calls yet.</p>
      )}
    </div>
  );
}

function RunLink({ agent, label, onSelect }: { agent: WorkspaceAgent; label: ReactNode; onSelect: () => void }) {
  return (
    <li>
      <button onClick={onSelect} className="flex w-full flex-col gap-0.5 rounded-lg border border-line-subtle px-3 py-2 text-left hover:bg-hover">
        <span className="flex min-w-0 items-center gap-1.5 text-small">
          <StatusDot status={agent.status} />
          <span className="truncate font-medium text-fg">{label}</span>
        </span>
        <span className="truncate text-small text-fg-muted">{agent.activity}</span>
        {agent.title && <span className="line-clamp-2 text-small text-fg-disabled">{agent.title}</span>}
      </button>
    </li>
  );
}

function Header({ desk, onBack, children }: { desk: Desk; onBack: () => void; children?: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-1 border-b border-line-subtle px-2 py-2">
        <IconButton label="Back to all agents" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <span className="truncate text-small text-fg-muted">All agents</span>
      </div>
      <div className="flex flex-col gap-2 px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Swatch color={desk.accent} className="size-3" />
            <h2 className="truncate text-h4 font-semibold text-fg">{desk.name}</h2>
          </div>
          <StatusChip status={desk.status} />
        </div>
        <p className="text-fg-secondary">{desk.activity}</p>
        {children}
      </div>
    </>
  );
}

function Details({ desk, snap, office, onBack, onSelect }: { desk: Desk; snap: WorkspaceSnapshot; office: Office; onBack: () => void; onSelect: (id: string) => void }) {
  const now = useNow(5_000);
  const byId = new Map(snap.agents.map((a) => [a.id, a]));

  if (desk.zone === 'team' && desk.member) {
    const m = desk.member;
    const lead = desk.agents[0];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Header desk={desk} onBack={onBack}>
          <p className="text-small text-fg-muted">{m.role}</p>
        </Header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <Facts
            rows={[
              ['Agent', <code className="font-mono">{m.type}</code>],
              ['Model', m.model ?? 'Inherits'],
              ['Defined in', m.source === 'user' ? '~/.claude/agents' : 'the project'],
            ]}
          />
          {lead ? (
            <>
              <div className="flex flex-col gap-2">
                <h3 className="text-small font-medium text-fg-muted">{desk.agents.length === 1 ? 'Current run' : `${desk.agents.length} runs`}</h3>
                <ul className="flex flex-col gap-1.5">
                  {desk.agents.map((a) => {
                    const parent = a.parentId ? byId.get(a.parentId) : undefined;
                    return <RunLink key={a.id} agent={a} label={parent ? `For ${parent.name}` : 'Sub agent run'} onSelect={() => parent && onSelect(parent.id)} />;
                  })}
                </ul>
              </div>
              <Recent agent={lead} now={now} />
            </>
          ) : (
            <p className="text-small text-fg-muted">
              Off duty. A session puts {m.name} to work by spawning the <code className="font-mono">{m.type}</code> agent.
            </p>
          )}
        </div>
      </div>
    );
  }

  const agent = desk.agents[0];
  const parent = agent.parentId ? byId.get(agent.parentId) : undefined;
  const delegated = snap.agents.filter((a) => a.parentId === agent.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header desk={desk} onBack={onBack}>
        {agent.title && <p className="line-clamp-3 text-small text-fg-muted">{agent.title}</p>}
        {parent && (
          <button onClick={() => onSelect(parent.id)} className="flex items-center gap-1.5 self-start text-small text-fg-muted hover:text-fg">
            <CornerDownRight className="size-3.5" aria-hidden /> Spawned by <span className="font-medium text-fg-secondary">{parent.name}</span>
          </button>
        )}
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Facts
          rows={[
            ['Role', agent.role],
            ['Model', shortModel(agent.model) ?? '—'],
            ['Project', agent.cwd ? <span title={agent.cwd}>{tildify(agent.cwd)}</span> : (agent.project ?? '—')],
            ['Running for', agent.startedAt ? formatDuration(agent.startedAt, agent.status === 'working' ? null : agent.lastAt, now) : '—'],
            ['Last activity', formatRelative(agent.lastAt, now)],
          ]}
        />
        {delegated.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-small font-medium text-fg-muted">Delegated to</h3>
            <ul className="flex flex-col gap-1.5">
              {delegated.map((s) => (
                <RunLink key={s.id} agent={s} label={s.name} onSelect={() => onSelect(deskIdFor(s, office))} />
              ))}
            </ul>
          </div>
        )}
        <Recent agent={agent} now={now} />
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {agent.taskId ? (
            <Link to="/tasks/$taskId" params={{ taskId: agent.taskId }} className={buttonClass('secondary', 'sm')}>
              <ExternalLink aria-hidden /> Open task
            </Link>
          ) : (
            <Link to="/sessions" className={buttonClass('secondary', 'sm')}>
              <ExternalLink aria-hidden /> View sessions
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY: WorkspaceSnapshot = { at: '', agents: [], team: [] };

export function WorkspacePage() {
  const { data, error } = useQuery({ queryKey: qk.workspace, queryFn: api.workspace, refetchInterval: 30_000 });
  const snap = data ?? EMPTY;
  const office = useMemo(() => officeFor(snap), [snap]);
  const desks = useMemo(() => allDesks(office), [office]);
  const night = useNightScene();
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const wide = useMedia('(min-width: 1024px)');

  const root = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(root);
  const toggleFullscreen = fullscreen.toggle;
  const sceneRef = useRef<WorkspaceScene | null>(null);
  const labelEls = useRef(new Map<string, HTMLElement>());
  const [ready, setReady] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'far' | 'mid' | 'near'>('mid');
  const [rosterOpen, setRosterOpen] = useState(false);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setRosterOpen(true);
  };

  // The scene is heavy, so it loads with this page rather than with the app.
  useEffect(() => {
    let disposed = false;
    let scene: WorkspaceScene | null = null;
    import('@/workspace/scene')
      .then(({ WorkspaceScene }) => {
        if (disposed || !mount.current) return;
        try {
          scene = new WorkspaceScene(mount.current, { night, reducedMotion });
        } catch (e) {
          setGlError((e as Error).message || 'WebGL is not available');
          return;
        }
        sceneRef.current = scene;
        scene.onPick = (id) => {
          setSelected(id);
          if (id) setRosterOpen(true);
        };
        scene.onFrame = (labels: LabelPos[], px: number) => {
          for (const l of labels) {
            const el = labelEls.current.get(l.id);
            if (!el) continue;
            el.style.visibility = l.visible ? 'visible' : 'hidden';
            el.style.transform = `translate3d(${Math.round(l.x)}px, ${Math.round(l.y)}px, 0) translate(-50%, -100%)`;
          }
          const z = px < 7 ? 'far' : px < 14 ? 'mid' : 'near';
          setZoom((prev) => (prev === z ? prev : z));
        };
        setReady(true);
      })
      .catch((e) => setGlError((e as Error).message));
    return () => {
      disposed = true;
      scene?.dispose();
      sceneRef.current = null;
    };
    // Theme and motion changes are pushed in below without rebuilding the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // F toggles fullscreen, unless the key is meant for a text field.
  useEffect(() => {
    if (!fullscreen.supported) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen.supported, toggleFullscreen]);

  useEffect(() => sceneRef.current?.setTheme(night), [night, ready]);
  useEffect(() => sceneRef.current?.setReducedMotion(reducedMotion), [reducedMotion, ready]);
  useEffect(() => sceneRef.current?.setOffice(office), [office, ready]);
  // Keep the office centered in the part of the canvas the side panel leaves free.
  useEffect(() => sceneRef.current?.setInsetRight(wide ? 344 : 0), [wide, ready]);

  // A selection is a desk, or a session or hot-desk run that didn't fit in the office.
  const selectedDesk = useMemo(() => {
    if (!selected) return null;
    const d = desks.find((x) => x.id === selected);
    if (d) return d;
    const a = snap.agents.find((x) => x.id === selected);
    return a ? deskOf(a) : null;
  }, [selected, desks, snap]);
  useEffect(() => {
    if (selected && data && !selectedDesk) setSelected(null);
  }, [selected, selectedDesk, data]);
  useEffect(() => sceneRef.current?.select(selected), [selected, ready]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const mains = snap.agents.filter((a) => a.kind === 'main');
  const subs = snap.agents.filter((a) => a.kind === 'sub');
  const known = new Set(snap.team.map((m) => m.type));
  const guests = subs.filter((s) => !known.has(s.role));
  const busyTeam = office.team.filter((d) => d.status === 'working').length;
  const online = mains.length + subs.filter((s) => s.status !== 'done').length;
  // Busy teammates first in the list; desks in the office keep their places.
  const teamRows = [...office.team].sort((a, b) => Number(a.status === 'off') - Number(b.status === 'off') || a.name.localeCompare(b.name));
  const deskFor = (a: WorkspaceAgent) => desks.find((x) => x.id === a.id) ?? deskOf(a);

  const setLabelRef = (id: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(id, el);
    else labelEls.current.delete(id);
  };

  return (
    <div ref={root} className="relative flex min-h-[480px] flex-1 overflow-hidden bg-[#05070d]">
      <h1 className="sr-only">Workspace</h1>
      <div ref={mount} className="absolute inset-0" aria-hidden />

      {/* Name plates track the scene every frame; the roster is the accessible view of the same desks. */}
      {ready && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {desks.map((d) => (
            <DeskLabel
              key={d.id}
              desk={d}
              compact={zoom === 'far' || (zoom === 'mid' && d.status === 'off')}
              selected={d.id === selected}
              onSelect={() => select(d.id)}
              setRef={setLabelRef(d.id)}
            />
          ))}
          <span
            ref={setLabelRef('__online')}
            style={{ visibility: 'hidden' }}
            className="absolute left-0 top-0 flex items-center gap-2 rounded-md border border-white/10 bg-black/75 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-white will-change-transform"
          >
            <span className={cn('size-2 rounded-full', online ? 'bg-[#3fb950]' : 'bg-white/30')} />
            {online} {online === 1 ? 'agent' : 'agents'} online
          </span>
        </div>
      )}

      {/* Heading */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-0.5 rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white backdrop-blur-md sm:left-6 sm:top-6">
        <span className="text-h4 font-semibold tracking-[-0.01em]">Workspace</span>
        <span className="text-small text-white/70" aria-live="polite">
          {mains.length} {mains.length === 1 ? 'session' : 'sessions'} · {busyTeam} of {office.team.length} teammates working
        </span>
      </div>

      {/* View controls */}
      <div className="absolute left-4 top-24 flex items-center gap-2 sm:left-6 lg:bottom-6 lg:top-auto">
        <button
          onClick={() => {
            setSelected(null);
            sceneRef.current?.resetView();
          }}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/15 bg-black/60 px-3 text-small font-medium text-white backdrop-blur-md hover:bg-black/80"
        >
          <Crosshair className="size-4" aria-hidden /> Reset view
        </button>
        {fullscreen.supported && (
          <button
            onClick={fullscreen.toggle}
            aria-pressed={fullscreen.active}
            title={`${fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'} (F)`}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/15 bg-black/60 px-3 text-small font-medium text-white backdrop-blur-md hover:bg-black/80"
          >
            {fullscreen.active ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
            {fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        )}
        <span className="hidden text-small text-white/60 lg:inline">Drag to orbit · scroll to zoom · right-drag to pan · F for fullscreen</span>
      </div>

      {(error || glError) && (
        <div className="absolute left-1/2 top-24 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2">
          <ErrorNote>{glError ? `The 3D workspace could not start (${glError}). The agent list still works.` : (error as Error).message}</ErrorNote>
        </div>
      )}

      {data && !mains.length && (
        <div className="absolute left-1/2 top-1/2 hidden w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 translate-y-16 rounded-xl border border-white/10 bg-black/70 p-5 text-center text-white backdrop-blur-md lg:block">
          <p className="font-semibold">The command desks are empty</p>
          <p className="mt-1 text-small text-white/70">
            Start a task here, or run claude or codex in a terminal. Sessions sit by the hologram, and your team gets to work at their own desks when a session calls them.
          </p>
          <Link to="/tasks/new" className={buttonClass('primary', 'sm', 'mt-4')}>
            <Plus aria-hidden /> New task
          </Link>
        </div>
      )}

      {/* Roster and details: a side panel on wide screens, a bottom sheet on small ones. */}
      <aside
        aria-label="Agents"
        className="absolute inset-x-3 bottom-3 flex max-h-[60%] flex-col overflow-hidden rounded-xl border border-line-subtle bg-surface/95 shadow-[var(--shadow-overlay)] backdrop-blur-md lg:inset-x-auto lg:bottom-6 lg:right-6 lg:top-6 lg:max-h-none lg:w-80"
      >
        {selectedDesk && (rosterOpen || wide) ? (
          <Details desk={selectedDesk} snap={snap} office={office} onBack={() => setSelected(null)} onSelect={select} />
        ) : (
          <>
            <button
              onClick={() => setRosterOpen(!rosterOpen)}
              aria-expanded={rosterOpen}
              className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-3 text-left lg:pointer-events-none"
            >
              <span className="flex items-center gap-2 font-medium text-fg">
                <Users className="size-4 text-fg-muted" aria-hidden /> Agents
                <span className="rounded-full bg-subtle px-2 text-small tabular-nums text-fg-muted">{online} online</span>
              </span>
              <ChevronDown className={cn('size-4 text-fg-muted transition-transform lg:hidden', rosterOpen && 'rotate-180')} aria-hidden />
            </button>
            <div className={cn('min-h-0 flex-1 overflow-y-auto px-2 pb-2', !rosterOpen && 'max-lg:hidden')}>
              {!data ? (
                <p className="px-2.5 py-6 text-center text-small text-fg-muted">Looking for agents…</p>
              ) : (
                <>
                  <Section title="Sessions" count={mains.length}>
                    {mains.length ? (
                      mains.map((a) => (
                        <RosterRow key={a.id} desk={deskFor(a)} sub={a.agent === 'claude' ? 'Claude' : 'Codex'} selected={a.id === selected} onSelect={() => select(a.id)} />
                      ))
                    ) : (
                      <li className="px-2.5 py-1.5 text-small text-fg-muted">No sessions active in the last 30 minutes.</li>
                    )}
                  </Section>
                  {teamRows.length > 0 && (
                    <Section title="Team" count={`${busyTeam}/${teamRows.length}`}>
                      {teamRows.map((d) => (
                        <RosterRow key={d.id} desk={d} selected={d.id === selected} onSelect={() => select(d.id)} />
                      ))}
                    </Section>
                  )}
                  {guests.length > 0 && (
                    <Section title="Hot desks" count={guests.length}>
                      {guests.map((a) => (
                        <RosterRow key={a.id} desk={deskFor(a)} selected={a.id === selected} onSelect={() => select(a.id)} />
                      ))}
                    </Section>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
