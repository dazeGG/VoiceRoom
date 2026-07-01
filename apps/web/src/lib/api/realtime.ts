// App-level WebSocket at /api/ws: account events, room summaries, preview/detail, voice.

import type { DirectMessage } from './dm';
import type { ChatMessage, RoomPeer, RoomSummary } from './rooms';

export type RealtimeAccountEvent =
  | { type: 'ready'; payload: { userId?: string; guest?: boolean; onlineFriendIds?: string[] } }
  | { type: 'pong'; payload: { at: number } }
  | { type: 'friend.presence'; payload: { userId: string; online: boolean } }
  | { type: 'friend.request'; payload: { direction: 'incoming' | 'outgoing' } }
  | { type: 'friend.accepted'; payload: { userId: string } }
  | { type: 'friend.removed'; payload: { userId: string } }
  | { type: 'dm.message'; payload: { message: DirectMessage } }
  | { type: 'dm.read'; payload: { userId: string } };

export type RoomRealtimeSummary = RoomSummary & {
  visiblePeers: RoomPeer[];
  hiddenPeerCount: number;
  lastMessageAt?: number | null;
  unreadCount?: number;
};

export type RoomSnapshot = {
  roomId: string;
  room: RoomSummary;
  peers: RoomPeer[];
  recentMessages?: ChatMessage[];
  mode: 'preview' | 'active';
};

export type RealtimeRoomEvent =
  | { type: 'room.summary'; payload: { room: RoomRealtimeSummary } }
  | { type: 'room.snapshot'; payload: RoomSnapshot }
  | { type: 'room.peer.joined'; payload: { roomId: string; peer: RoomPeer } }
  | { type: 'room.peer.left'; payload: { roomId: string; peerId: string; reason: string } }
  | { type: 'room.peer.updated'; payload: { roomId: string; peer: RoomPeer } }
  | { type: 'room.chat.message'; payload: { roomId: string; message: ChatMessage } }
  | { type: 'room.updated'; payload: { room: RoomSummary } }
  | { type: 'room.deleted'; payload: { roomId: string } }
  | { type: 'room.not_found'; payload: { roomId: string } }
  | { type: 'room.full'; payload: { roomId: string; maxRoomPeers: number } };

export type RealtimeEvent = RealtimeAccountEvent | RealtimeRoomEvent;

/** @deprecated Use RealtimeEvent */
export type { RealtimeEvent as RealtimeEventUnion };

type ServerEnvelope = {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export interface RealtimeHandle {
  close: () => void;
  send: (type: string, payload?: Record<string, unknown>) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const HEARTBEAT_MS = 15000;

let shared: AppRealtimeConnection | null = null;

function wsUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1/api/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws`;
}

function parseRealtimeEvent(envelope: ServerEnvelope): RealtimeEvent | null {
  if (!envelope || typeof envelope.type !== 'string' || envelope.type === 'error') return null;
  return { type: envelope.type, payload: envelope.payload ?? {} } as RealtimeEvent;
}

class AppRealtimeConnection {
  private socket: WebSocket | null = null;
  private handlers = new Set<(event: RealtimeEvent) => void>();
  private refCount = 0;
  private closedByClient = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outboundQueue: string[] = [];
  private restoreHandlers = new Set<() => void>();

  subscribe(handler: (event: RealtimeEvent) => void): () => void {
    this.handlers.add(handler);
    this.refCount += 1;
    this.ensureConnected();
    return () => {
      this.handlers.delete(handler);
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this.disconnect();
    };
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    const frame = JSON.stringify({ type, payload });
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.outboundQueue.push(frame);
      this.ensureConnected();
      return;
    }
    this.socket.send(frame);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emit(event: RealtimeEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    while (this.outboundQueue.length > 0) {
      const next = this.outboundQueue.shift();
      if (next) this.socket.send(next);
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByClient || this.refCount === 0) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send('ping', { at: Date.now() });
    }, HEARTBEAT_MS);
  }

  private openSocket(): void {
    this.socket = new WebSocket(wsUrl());
    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.send('hello', {});
      for (const restore of this.restoreHandlers) restore();
      this.flushQueue();
      this.startHeartbeat();
    };
    this.socket.onmessage = (event) => {
      let envelope: ServerEnvelope | null = null;
      try {
        envelope = JSON.parse(String(event.data)) as ServerEnvelope;
      } catch {
        return;
      }
      const parsed = parseRealtimeEvent(envelope);
      if (parsed) this.emit(parsed);
    };
    this.socket.onclose = () => {
      this.clearTimers();
      this.socket = null;
      this.scheduleReconnect();
    };
    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  onRestore(handler: () => void): () => void {
    this.restoreHandlers.add(handler);
    return () => {
      this.restoreHandlers.delete(handler);
    };
  }

  ensureConnected(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByClient = false;
    this.openSocket();
  }

  private disconnect(): void {
    this.closedByClient = true;
    this.clearTimers();
    this.outboundQueue.length = 0;
    this.socket?.close();
    this.socket = null;
  }
}

export function getAppRealtime(): AppRealtimeConnection {
  if (!shared) shared = new AppRealtimeConnection();
  return shared;
}

export function connectRealtime(onEvent: (event: RealtimeEvent) => void): RealtimeHandle {
  const conn = getAppRealtime();
  const unsubscribe = conn.subscribe(onEvent);
  return {
    close: unsubscribe,
    send: (type, payload = {}) => conn.send(type, payload)
  };
}