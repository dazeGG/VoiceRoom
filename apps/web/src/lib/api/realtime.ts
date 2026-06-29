// Global per-user realtime stream (/api/realtime). The server emits all frames
// as default `message` events (see sendSse in server.js), so a single onmessage
// handler covers every event type. EventSource auto-reconnects on transient
// drops; a fresh connection re-announces presence and re-sends `ready`.

import type { DirectMessage } from './dm';

export type RealtimeEvent =
  | { type: 'ready'; onlineFriendIds: string[] }
  | { type: 'ping'; at: number }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'friend-request' }
  | { type: 'friend-accepted'; userId: string }
  | { type: 'friend-removed'; userId: string }
  | { type: 'dm-message'; message: DirectMessage }
  | { type: 'dm-read'; userId: string };

export interface RealtimeHandle {
  close: () => void;
}

export function connectRealtime(onEvent: (event: RealtimeEvent) => void): RealtimeHandle {
  const source = new EventSource('/api/realtime', { withCredentials: true });

  source.onmessage = (event) => {
    let parsed: RealtimeEvent | null = null;
    try {
      parsed = JSON.parse(event.data) as RealtimeEvent;
    } catch {
      return;
    }
    if (parsed && typeof parsed.type === 'string') {
      onEvent(parsed);
    }
  };

  return {
    close: () => source.close()
  };
}
