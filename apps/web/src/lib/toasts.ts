import { useSyncExternalStore } from 'react';
import type { HubNotification } from '@axis/shared';

const MAX = 4;
const TTL_MS = 7000;

let items: HubNotification[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** In-app toasts fed by hub notifications. */
export const toasts = {
  push(n: HubNotification) {
    items = [n, ...items.filter((i) => i.id !== n.id)].slice(0, MAX);
    emit();
    setTimeout(() => toasts.dismiss(n.id), TTL_MS);
  },
  dismiss(id: string) {
    const next = items.filter((i) => i.id !== id);
    if (next.length !== items.length) {
      items = next;
      emit();
    }
  },
};

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
}
