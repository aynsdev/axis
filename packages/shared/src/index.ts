export type AgentKind = 'claude' | 'codex';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const ACTIVE_STATUSES: TaskStatus[] = ['queued', 'running'];

/** How much the agent may do without asking. Mapped per agent by the runner. */
export type PermissionLevel = 'edits' | 'full';

export type TaskSource = 'ui' | 'webhook';

export type TaskPriority = 'high' | 'normal' | 'low';

export type PrState = 'open' | 'draft' | 'merged' | 'closed';
export type PrChecks = 'passing' | 'failing' | 'pending' | 'none';

export interface PullRequest {
  url: string;
  number: number;
  state: PrState;
  checks: PrChecks;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null. */
  review: string | null;
  updatedAt: string;
}

export interface Repo {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  createdAt: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  agent: AgentKind;
  model: string | null;
  permission: PermissionLevel;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  repoId: string;
  repoName: string;
  baseBranch: string;
  branch: string;
  worktreePath: string | null;
  sessionId: string | null;
  pid: number | null;
  error: string | null;
  summary: string | null;
  /** Open a draft PR automatically when the task succeeds with commits. */
  autoPr: boolean;
  pr: PullRequest | null;
  usage: Usage;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type TaskEventKind = 'system' | 'message' | 'tool' | 'tool_result' | 'stderr' | 'error' | 'result';

export interface TaskEvent {
  id: number;
  taskId: string;
  kind: TaskEventKind;
  text: string;
  createdAt: string;
}

export interface CreateTaskInput {
  repoId: string;
  prompt: string;
  agent: AgentKind;
  title?: string;
  model?: string;
  permission?: PermissionLevel;
  baseBranch?: string;
  autoPr?: boolean;
  priority?: TaskPriority;
}

export interface Template {
  id: string;
  name: string;
  prompt: string;
  agent: AgentKind;
  model: string | null;
  permission: PermissionLevel;
  autoPr: boolean;
  /** Optional default repository. */
  repoId: string | null;
  createdAt: string;
}

export type TemplateInput = Omit<Template, 'id' | 'createdAt'>;

export const NOTIFY_EVENTS = {
  'task.succeeded': 'Task succeeded',
  'task.failed': 'Task failed',
  'pr.opened': 'Draft PR opened automatically',
  'pr.merged': 'PR merged or closed',
  'pr.checksFailed': 'PR checks failing',
  'codex.limit': 'Codex plan limit at 90%',
} as const;

export type NotifyEvent = keyof typeof NOTIFY_EVENTS;

export interface Settings {
  maxConcurrency: number;
  notifications: {
    /** macOS notification center. */
    desktop: boolean;
    sound: boolean;
    events: Record<NotifyEvent, boolean>;
  };
}

export interface HubNotification {
  id: string;
  event: NotifyEvent | 'test';
  title: string;
  body: string;
  level: 'success' | 'error' | 'warning' | 'info';
  /** Dashboard path to open, e.g. /tasks/abc. */
  path?: string;
  /** External link, e.g. the PR. */
  url?: string;
  createdAt: string;
}

export interface OpenPrInput {
  title?: string;
  body?: string;
  draft?: boolean;
}

export interface GithubStatus {
  installed: boolean;
  authenticated: boolean;
  user: string | null;
}

export interface Stats {
  running: number;
  queued: number;
  finishedToday: number;
  failedToday: number;
  costTodayUsd: number;
  tokensToday: number;
  maxConcurrency: number;
}

export type AgentFilter = AgentKind | 'all';

/** Token counts from transcripts. `input` excludes cache reads and writes. */
export interface TokenTotals {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  /** API-equivalent estimate; only Claude models are priced. */
  costUsd: number;
}

export interface UsageDay extends TokenTotals {
  date: string;
  sessions: number;
}

export interface RateLimitWindow {
  label: string;
  usedPercent: number;
  windowMinutes: number;
  /** Unix seconds. */
  resetsAt: number | null;
}

export interface UsageReport {
  days: UsageDay[];
  totals: TokenTotals & { sessions: number };
  byAgent: Array<TokenTotals & { agent: AgentKind; sessions: number }>;
  byModel: Array<TokenTotals & { agent: AgentKind; model: string; sessions: number }>;
  /** `priced` is false when a project only has Codex usage, which has no cost estimate. */
  byProject: Array<TokenTotals & { cwd: string; project: string; sessions: number; priced: boolean }>;
  codexLimits: { at: string; plan: string | null; windows: RateLimitWindow[] } | null;
  lastScanAt: string | null;
}

export interface LocalSession extends TokenTotals {
  key: string;
  agent: AgentKind;
  sessionId: string;
  title: string | null;
  cwd: string | null;
  project: string | null;
  model: string | null;
  origin: string | null;
  firstAt: string | null;
  lastAt: string | null;
  turns: number;
  /** Set when the hub started this session. */
  taskId: string | null;
}

export interface TaskDiff {
  stat: string;
  patch: string;
  commitsAhead: number;
}

export type ServerMessage =
  | { type: 'task.updated'; task: Task }
  | { type: 'task.event'; event: TaskEvent }
  | { type: 'usage.updated' }
  | { type: 'notification'; notification: HubNotification }
  | { type: 'settings.updated'; settings: Settings };
