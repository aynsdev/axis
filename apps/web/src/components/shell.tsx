import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  ChevronLeft,
  FolderGit2,
  Globe,
  History,
  LayoutGrid,
  ListTodo,
  Menu,
  Monitor,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, qk } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ConnectionState } from '@/lib/live';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { buttonClass, IconButton } from './ui';

interface NavItem {
  to: '/' | '/tasks' | '/sessions' | '/usage' | '/repos' | '/settings';
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Navigation source, grouped by intent and kept apart from rendering so a command palette can reuse it.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Agents',
    items: [
      { to: '/', label: 'Overview', icon: LayoutGrid, exact: true },
      { to: '/tasks', label: 'Tasks', icon: ListTodo },
      { to: '/sessions', label: 'Sessions', icon: History },
    ],
  },
  { label: 'Insights', items: [{ to: '/usage', label: 'Usage', icon: BarChart3 }] },
  {
    label: 'Setup',
    items: [
      { to: '/repos', label: 'Repositories', icon: FolderGit2 },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const COLLAPSE_KEY = 'axis-sidebar-collapsed';

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

function LogoMark() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-action text-on-action">
      <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
        <path d="M8 23 16 8l8 15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" aria-label={collapsed ? 'Axis home' : undefined} className={cn('flex h-9 min-w-0 items-center gap-2.5 rounded-lg text-fg', collapsed ? 'justify-center' : 'px-1.5')}>
      <LogoMark />
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-semibold tracking-[-0.01em]">Axis</span>
          <span className="truncate text-small text-fg-muted">Agents hub</span>
        </span>
      )}
    </Link>
  );
}

const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';

/** The desktop collapse control sits on the sidebar's edge, astride the header divider, because it acts on the sidebar. */
function CollapseHandle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = `${collapsed ? 'Expand' : 'Collapse'} sidebar (${SHORTCUT})`;
  return (
    <button
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className="absolute -right-3 top-[var(--header-height)] z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg-muted shadow-sm transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ChevronLeft className={cn('size-3.5 transition-transform duration-200', collapsed && 'rotate-180')} aria-hidden />
    </button>
  );
}

function RunningCount() {
  const { data } = useQuery({ queryKey: qk.stats, queryFn: api.stats });
  if (!data?.running) return null;
  return (
    <span className="ml-auto rounded-full bg-info-bg px-2 text-small font-medium tabular-nums text-info" aria-label={`${data.running} running`}>
      {data.running}
    </span>
  );
}

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex flex-col gap-0.5">
          {collapsed ? (
            // Collapsed, a hairline keeps groups apart where the label used to be.
            gi > 0 && <span aria-hidden className="mx-auto mb-1 h-px w-5 bg-line" />
          ) : (
            <span aria-hidden className="px-2.5 pb-1 text-small font-medium text-fg-disabled">
              {group.label}
            </span>
          )}
          {group.items.map((item) => {
            const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group/nav relative flex h-9 items-center gap-3 rounded-lg px-2.5 transition-colors',
                  active ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  collapsed && 'justify-center px-0',
                )}
              >
                <Icon className={cn('size-[18px] shrink-0', active && 'text-fg')} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                {collapsed ? (
                  <>
                    <span className="sr-only">{item.label}</span>
                    {/* Visible label for pointer and keyboard users once the rail hides it. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-small font-medium text-fg opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100"
                    >
                      {item.label}
                    </span>
                  </>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
                {!collapsed && item.to === '/tasks' && <RunningCount />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ collapsed, connection }: { collapsed?: boolean; connection: ConnectionState }) {
  const label = { live: 'Connected to hubd', connecting: 'Connecting…', offline: 'hubd offline · retrying' }[connection];
  return (
    <div className={cn('flex h-8 items-center gap-2.5 px-2.5 text-small text-fg-muted', collapsed && 'justify-center px-0')} title={label} role="status">
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full',
          connection === 'live' ? 'bg-success' : connection === 'offline' ? 'bg-error' : 'bg-fg-disabled',
        )}
      />
      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </div>
  );
}

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { dark: 'light', light: 'system', system: 'dark' };
const THEME_ICON: Record<ThemeChoice, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };

/** The live 3D office lives in the header, a shortcut you reach from any page. */
function WorkspaceLink({ active }: { active: boolean }) {
  return (
    <Link
      to="/workspace"
      aria-label="Workspace"
      title="Workspace"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-lg transition-colors [&_svg]:size-[18px]',
        active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <Globe strokeWidth={active ? 2.25 : 1.75} aria-hidden />
    </Link>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const Icon = THEME_ICON[theme];
  return (
    <IconButton label={`Theme: ${theme}. Switch to ${THEME_NEXT[theme]}`} onClick={() => setTheme(THEME_NEXT[theme])}>
      <Icon />
    </IconButton>
  );
}

export function AppShell({ connection, children }: { connection: ConnectionState; children: ReactNode }) {
  const [collapsed, setCollapsed] = useCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // ⌘B / Ctrl+B toggles the sidebar, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setCollapsed((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCollapsed]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-svh w-full">
      {/* Desktop sidebar */}
      <aside
        data-surface="dark"
        className={cn(
          'relative z-40 hidden shrink-0 flex-col border-r border-line-subtle bg-surface text-fg-secondary transition-[width] duration-200 md:flex',
          collapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]',
        )}
      >
        <div className={cn('flex h-[var(--header-height)] shrink-0 items-center border-b border-line-subtle', collapsed ? 'justify-center' : 'px-3')}>
          <Brand collapsed={collapsed} />
        </div>
        {/* Tooltips escape the rail, so the nav only scrolls when expanded. */}
        <div className={cn('flex-1 py-4', collapsed ? 'px-1.5' : 'overflow-y-auto px-3')}>
          <NavLinks collapsed={collapsed} />
        </div>
        <div className={cn('border-t border-line-subtle p-3', collapsed && 'px-1.5')}>
          <SidebarFooter collapsed={collapsed} connection={connection} />
        </div>
        <CollapseHandle collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <div data-surface="dark" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line-subtle bg-surface text-fg-secondary shadow-[var(--shadow-overlay)]">
            <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between border-b border-line-subtle px-3">
              <Brand />
              <IconButton label="Close navigation" onClick={() => setMobileOpen(false)}>
                <X />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-line-subtle p-3">
              <SidebarFooter connection={connection} />
            </div>
          </div>
        </div>
      )}

      {/* Content inset: the single vertical scroll owner */}
      <main className="flex h-svh min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" id="content">
        <header className="sticky top-0 z-30 flex h-[var(--header-height)] shrink-0 items-center justify-between gap-3 border-b border-line-subtle bg-surface px-4 sm:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <IconButton label="Open navigation" className="-ml-1.5 md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu />
            </IconButton>
            <span className="truncate text-fg-muted md:hidden">Axis</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pathname !== '/tasks/new' && pathname !== '/tasks' && (
              <Link to="/tasks/new" className={buttonClass('secondary', 'sm')}>
                <Plus aria-hidden />
                <span className="hidden sm:inline">New task</span>
                <span className="sr-only sm:hidden">New task</span>
              </Link>
            )}
            <WorkspaceLink active={pathname === '/workspace'} />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
