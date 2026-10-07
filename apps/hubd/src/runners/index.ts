import type { AgentKind } from '@aynshq/shared';
import { runClaude } from './claude.ts';
import { runCodex } from './codex.ts';
import type { Runner } from './types.ts';

export const runners: Record<AgentKind, Runner> = {
  claude: runClaude,
  codex: runCodex,
};

export type { RunHandle } from './types.ts';
