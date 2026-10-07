import type { WorkerStatus } from '@axis/shared';
import { hash } from './random';

export const ACCENTS = ['#8b5cf6', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#a3e635', '#f97316', '#14b8a6', '#e879f9', '#facc15'];

export type DeskStatus = WorkerStatus | 'off';

export const STATUS_COLORS: Record<DeskStatus, string> = { working: '#3fb950', idle: '#f0b232', done: '#58a6ff', off: '#6e7681' };

export const SESSION_ACCENTS = { claude: '#d97757', codex: '#10a37f' } as const;

/** A stable color per agent type, so a persona keeps its look across sessions. */
export const accentForType = (type: string) => ACCENTS[hash(type) % ACCENTS.length];
