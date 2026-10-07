import type {
  AgentFilter,
  CreateTaskInput,
  GithubStatus,
  LocalSession,
  OpenPrInput,
  Settings,
  TaskPriority,
  Template,
  TemplateInput,
  Repo,
  Stats,
  Task,
  TaskDiff,
  TaskEvent,
  UsageReport,
} from '@aynshq/shared';

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-aynshq': '1', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  repos: () => request<Repo[]>('/repos'),
  addRepo: (path: string) => post<Repo>('/repos', { path }),
  removeRepo: (id: string) => request<void>(`/repos/${id}`, { method: 'DELETE' }),

  tasks: () => request<Task[]>('/tasks'),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  events: (id: string) => request<TaskEvent[]>(`/tasks/${id}/events`),
  diff: (id: string) => request<TaskDiff>(`/tasks/${id}/diff`),
  createTask: (input: CreateTaskInput) => post<Task>('/tasks', input),
  cancelTask: (id: string) => post<Task>(`/tasks/${id}/cancel`),
  retryTask: (id: string) => post<Task>(`/tasks/${id}/retry`),
  removeWorktree: (id: string) => request<Task>(`/tasks/${id}/worktree`, { method: 'DELETE' }),
  openPr: (id: string, input: OpenPrInput) => post<Task>(`/tasks/${id}/pr`, input),
  refreshPr: (id: string) => post<Task>(`/tasks/${id}/pr/refresh`),
  setPriority: (id: string, priority: TaskPriority) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ priority }) }),
  github: () => request<GithubStatus>('/github'),
  settings: () => request<Settings>('/settings'),
  saveSettings: (s: Settings) => request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  testNotification: () => post<void>('/notifications/test'),
  templates: () => request<Template[]>('/templates'),
  createTemplate: (t: TemplateInput) => post<Template>('/templates', t),
  removeTemplate: (id: string) => request<void>(`/templates/${id}`, { method: 'DELETE' }),
  repoRemote: (id: string) => request<{ url: string | null }>(`/repos/${id}/remote`),

  stats: () => request<Stats>('/stats'),
  usage: (days: number, agent: AgentFilter) => request<UsageReport>(`/usage?days=${days}&agent=${agent}`),
  sessions: (days: number, agent: AgentFilter, limit = 100) =>
    request<LocalSession[]>(`/sessions?days=${days}&agent=${agent}&limit=${limit}`),
  rescan: () => post<{ files: number; changed: number; ms: number }>('/usage/rescan'),
};

export const qk = {
  repos: ['repos'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['task', id] as const,
  events: (id: string) => ['events', id] as const,
  diff: (id: string) => ['diff', id] as const,
  stats: ['stats'] as const,
  github: ['github'] as const,
  settings: ['settings'] as const,
  templates: ['templates'] as const,
  repoRemote: (id: string) => ['repoRemote', id] as const,
  usage: (days: number, agent: AgentFilter) => ['usage', days, agent] as const,
  sessions: (days: number, agent: AgentFilter) => ['sessions', days, agent] as const,
};
