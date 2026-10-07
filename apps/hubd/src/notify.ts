import { execFile } from 'node:child_process';
import type { HubNotification, NotifyEvent } from '@aynshq/shared';
import { bus } from './bus.ts';
import { config } from './config.ts';
import { newId } from './db.ts';
import { getSettings } from './settings.ts';

let notifierBin: string | null | undefined;

/** terminal-notifier supports click-to-open; osascript is the always-available fallback. */
function findNotifier(): Promise<string | null> {
  if (notifierBin !== undefined) return Promise.resolve(notifierBin);
  return new Promise((resolve) =>
    execFile('/usr/bin/which', ['terminal-notifier'], (err, out) => {
      notifierBin = err ? null : out.trim() || null;
      resolve(notifierBin);
    }),
  );
}

const appleString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function desktop(n: HubNotification, sound: boolean) {
  if (process.platform !== 'darwin') return;
  const open = n.url ?? (n.path ? `${config.webUrl}${n.path}` : config.webUrl);
  const bin = await findNotifier();
  if (bin) {
    const args = ['-title', 'aynshq', '-subtitle', n.title, '-message', n.body || ' ', '-open', open, '-group', `aynshq-${n.path ?? n.event}`];
    if (sound) args.push('-sound', n.level === 'error' ? 'Basso' : 'Glass');
    execFile(bin, args, () => {});
    return;
  }
  const script = `display notification ${appleString(n.body)} with title "aynshq" subtitle ${appleString(n.title)}${sound ? ' sound name "Glass"' : ''}`;
  execFile('/usr/bin/osascript', ['-e', script], () => {});
}

/**
 * Sends a notification to open dashboards (as a toast) and, if enabled, to the
 * macOS notification center. Respects the per-event toggles in settings.
 */
export function notify(event: NotifyEvent | 'test', n: Omit<HubNotification, 'id' | 'event' | 'createdAt'>) {
  const s = getSettings().notifications;
  if (event !== 'test' && !s.events[event]) return;
  const full: HubNotification = { ...n, id: newId(), event, createdAt: new Date().toISOString() };
  bus.publish({ type: 'notification', notification: full });
  if (s.desktop) void desktop(full, s.sound);
}
