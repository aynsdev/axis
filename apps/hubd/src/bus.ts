import type { ServerMessage } from '@aynshq/shared';

type Listener = (msg: ServerMessage) => void;
const listeners = new Set<Listener>();

export const bus = {
  publish(msg: ServerMessage) {
    for (const l of listeners) l(msg);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
