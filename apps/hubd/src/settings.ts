import { NOTIFY_EVENTS, type NotifyEvent, type Settings } from '@aynshq/shared';
import { bus } from './bus.ts';
import { config } from './config.ts';
import { kv } from './db.ts';

const KEY = 'settings';

const defaults = (): Settings => ({
  maxConcurrency: config.maxConcurrency,
  notifications: {
    desktop: process.platform === 'darwin',
    sound: true,
    events: Object.fromEntries(Object.keys(NOTIFY_EVENTS).map((e) => [e, true])) as Record<NotifyEvent, boolean>,
  },
});

let cached: Settings | undefined;

/** Stored settings merged over defaults, so new options get sensible values. */
export function getSettings(): Settings {
  if (cached) return cached;
  const stored = kv.get<Partial<Settings>>(KEY) ?? {};
  const d = defaults();
  cached = {
    maxConcurrency: stored.maxConcurrency ?? d.maxConcurrency,
    notifications: {
      ...d.notifications,
      ...stored.notifications,
      events: { ...d.notifications.events, ...stored.notifications?.events },
    },
  };
  return cached;
}

export function saveSettings(next: Settings): Settings {
  kv.set(KEY, next);
  cached = undefined;
  const s = getSettings();
  bus.publish({ type: 'settings.updated', settings: s });
  return s;
}
