import type { ServerMessage } from '@axis/shared';

type Listener = (msg: ServerMessage) => void;
const listeners = new Set<Listener>();

export const bus = {
  publish(msg: ServerMessage) {
    for (const l of listeners) l(msg);
  },
  /** True while any dashboard is connected. */
  get listening() {
    return listeners.size > 0;
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
