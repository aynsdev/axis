import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  FolderGit2,
  History,
  LayoutGrid,
  ListTodo,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
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

// Navigation source, kept apart from rendering so a command palette can reuse it.
export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutGrid, exact: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/sessions', label: 'Sessions', icon: History },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
  { to: '/repos', label: 'Repositories', icon: FolderGit2 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const COLLAPSE_KEY = 'aynshq-sidebar-collapsed';

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

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className="flex h-9 items-center gap-2.5 rounded-lg px-1.5 text-fg">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-action text-on-action">
        <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
          <path d="M8 23 16 8l8 15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!collapsed && (
        <span className="flex flex-col leading-tight">
          <span className="font-semibold tracking-[-0.01em]">aynshq</span>
          <span className="text-small text-fg-muted">Agents hub</span>
        </span>
      )}
    </Link>
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
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              'flex h-9 items-center gap-3 rounded-lg px-2.5 transition-colors',
              active ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
              collapsed && 'justify-center px-0',
            )}
          >
            <Icon className={cn('size-[18px] shrink-0', active && 'text-fg')} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
            {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
            {!collapsed && item.to === '/tasks' && <RunningCount />}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ collapsed, connection }: { collapsed?: boolean; connection: ConnectionState }) {
  const label = { live: 'Connected to hubd', connecting: 'Connecting…', offline: 'hubd offline · retrying' }[connection];
  return (
    <div className={cn('flex items-center gap-2.5 px-2.5 py-2 text-small text-fg-muted', collapsed && 'justify-center px-0')} title={label}>
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
        className={cn(
          'relative hidden shrink-0 flex-col border-r border-line-subtle bg-surface transition-[width] duration-200 md:flex',
          collapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]',
        )}
      >
        <div className={cn('flex h-[var(--header-height)] items-center px-3', collapsed && 'justify-center px-0')}>
          <Brand collapsed={collapsed} />
        </div>
        <div className={cn('flex-1 overflow-y-auto px-3 py-3', collapsed && 'px-2')}>
          <NavLinks collapsed={collapsed} />
        </div>
        <div className={cn('flex flex-col gap-1 border-t border-line-subtle p-3', collapsed && 'items-center px-2')}>
          <SidebarFooter collapsed={collapsed} connection={connection} />
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            className={cn(!collapsed && 'self-end')}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        </div>
      </aside>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line-subtle bg-surface shadow-[var(--shadow-overlay)]">
            <div className="flex h-[var(--header-height)] items-center justify-between px-3">
              <Brand />
              <IconButton label="Close navigation" onClick={() => setMobileOpen(false)}>
                <X />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
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
            <span className="truncate text-fg-muted md:hidden">aynshq</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pathname !== '/tasks/new' && pathname !== '/tasks' && (
              <Link to="/tasks/new" className={buttonClass('secondary', 'sm')}>
                <Plus aria-hidden />
                <span className="hidden sm:inline">New task</span>
                <span className="sr-only sm:hidden">New task</span>
              </Link>
            )}
            <ThemeToggle />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
