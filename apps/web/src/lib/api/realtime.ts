// App-level WebSocket at /api/ws: account events, room summaries, preview/detail, voice.

import type { DirectMessage } from './dm';
import type { PublicUser } from './friends';
import type { ChatMessage, RoomPeer, RoomSummary } from './rooms';
import type { NotificationRealtimeEvent } from '../shared/notifications';
import type { ReactionSummary } from '@voice-room/shared/reactions';
import {
  normalizeMusicCommand,
  type MusicSession,
  type MusicTrackRef
} from '@voice-room/shared/room-music';
import { isDesktopBoundaryBlocked } from '$lib/platform/desktop-boundary';
import { RealtimeHeartbeatWatchdog } from './realtime-heartbeat.js';

export type RealtimeAccountEvent =
  | { type: 'ready'; payload: { userId?: string; guest?: boolean; onlineFriendIds?: string[] } }
  | { type: 'pong'; payload: { at: number } }
  | { type: 'friend.presence'; payload: { userId: string; online: boolean } }
  | { type: 'friend.request'; payload: { direction: 'incoming' | 'outgoing' } }
  | { type: 'friend.accepted'; payload: { userId: string } }
  | { type: 'friend.removed'; payload: { userId: string } }
  | { type: 'friend.updated'; payload: { user: PublicUser } }
  | { type: 'ring.incoming'; payload: { fromUser: PublicUser; room: { id: string; name: string; emoji: string }; expiresAt: number } }
  | { type: 'notification.settings.updated'; payload: { preferences: import('./notifications').NotificationPreferences } }
  | { type: 'dm.message'; payload: { message: DirectMessage } }
  | { type: 'dm.message.edited'; payload: { message: DirectMessage } }
  | { type: 'dm.read'; payload: { userId: string } }
  | { type: 'dm.message.deleted'; payload: { messageId: string; peerUserId?: string } };

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
  // Server-side in-memory call clock: when the current voice session started
  // (first live peer), or null while the room is empty. Never persisted.
  voiceActiveSince?: number | null;
  // Shared-music block, present only on an `active` snapshot for a static room.
  // `musicBotIdentity` and `musicIsMaster` are siblings of `music` rather than
  // members of it, because `normalizeMusicSession` would strip an unknown key
  // from the session: the first is a transport detail the client needs to find
  // the bot's publication, the second is the viewer's own permission.
  music?: MusicSession;
  musicBotIdentity?: string | null;
  musicIsMaster?: boolean;
  mode: 'preview' | 'active';
};

export type RealtimeRoomEvent =
  | { type: 'room.summary'; payload: { room: RoomRealtimeSummary } }
  | { type: 'room.snapshot'; payload: RoomSnapshot }
  | { type: 'room.peer.joined'; payload: { roomId: string; peer: RoomPeer } }
  | { type: 'room.peer.left'; payload: { roomId: string; peerId: string; reason: string } }
  | { type: 'room.peer.updated'; payload: { roomId: string; peer: RoomPeer } }
  | { type: 'room.chat.message'; payload: { roomId: string; message: ChatMessage } }
  | { type: 'room.chat.edited'; payload: { roomId: string; message: ChatMessage } }
  | { type: 'room.chat.deleted'; payload: { roomId: string; messageId: string } }
  | { type: 'room.updated'; payload: { room: RoomSummary } }
  | { type: 'room.deleted'; payload: { roomId: string } }
  | { type: 'room.not_found'; payload: { roomId: string } }
  | { type: 'room.full'; payload: { roomId: string; maxRoomPeers: number } }
  | { type: 'room.kicked'; payload: { roomId: string; peerId?: string } }
  | { type: 'room.banned'; payload: { roomId: string; peerId?: string } };

export type RealtimeErrorEvent = { type: 'error'; payload: { code: string; message: string; id?: string } };
export type ReactionRealtimeEvent = {
  type: 'reaction.updated';
  payload: {
    conversation: { type: 'room' | 'dm'; id: string };
    roomId?: string;
    messageId: string;
    summary: ReactionSummary;
  };
};

export type PinsRealtimeEvent = {
  type: 'room.pins';
  payload: {
    roomId: string;
    action: 'pinned' | 'unpinned';
    messageId: string;
    pins: unknown;
    count: number;
  };
};

// Two event types, not one: `room.music.position` exists so the bot's 2s
// heartbeat does not re-broadcast a queue of up to 100 items. `musicBotIdentity`
// rides on both, because the bot can leave the room on its own initiative and a
// client must be able to learn (or unlearn) the identity without a fresh
// snapshot. Both are routed `activeOnly`, so a lobby preview receives neither.
export type MusicRealtimeEvent =
  | {
      type: 'room.music.state';
      payload: {
        roomId: string;
        music?: MusicSession;
        musicBotIdentity?: string | null;
      };
    }
  | {
      type: 'room.music.position';
      payload: {
        roomId: string;
        musicBotIdentity?: string | null;
        sessionEpoch?: number;
        itemId?: string | null;
        positionMs?: number;
        positionAt?: number | null;
      };
    };

export type RealtimeEvent = (
  RealtimeAccountEvent
  | RealtimeRoomEvent
  | RealtimeErrorEvent
  | NotificationRealtimeEvent
  | ReactionRealtimeEvent
  | PinsRealtimeEvent
  | MusicRealtimeEvent
) & { id?: string };

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
  send: (type: string, payload?: Record<string, unknown>, id?: string) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const HEARTBEAT_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 30000;

let shared: AppRealtimeConnection | null = null;

function wsUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1/api/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws`;
}

function parseRealtimeEvent(envelope: ServerEnvelope): RealtimeEvent | null {
  if (!envelope || typeof envelope.type !== 'string') return null;
  if (envelope.type === 'error') {
    return {
      type: 'error',
      payload: {
        code: envelope.error?.code || 'unknown_error',
        message: envelope.error?.message || 'WebSocket error',
        id: envelope.id
      }
    };
  }
  return {
    type: envelope.type,
    payload: envelope.payload ?? {},
    ...(envelope.id ? { id: envelope.id } : {})
  } as RealtimeEvent;
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
  private restoreHandlers = new Set<(connectionEpoch: number) => void>();
  private stateHandlers = new Set<(connected: boolean, connectionEpoch: number) => void>();
  private everConnected = false;
  private connectionEpoch = 0;
  private openGeneration = 0;
  private heartbeatWatchdog = new RealtimeHeartbeatWatchdog({ timeoutMs: HEARTBEAT_TIMEOUT_MS });

  subscribe(handler: (event: RealtimeEvent) => void): () => void {
    if (isDesktopBoundaryBlocked()) return () => {};
    this.handlers.add(handler);
    this.refCount += 1;
    this.ensureConnected();
    return () => {
      this.handlers.delete(handler);
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this.disconnect();
    };
  }

  send(type: string, payload: Record<string, unknown> = {}, id?: string): void {
    if (isDesktopBoundaryBlocked()) return;
    const frame = JSON.stringify({ ...(id ? { id } : {}), type, payload });
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
    this.heartbeatWatchdog.reset();
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
    if (this.closedByClient || this.refCount === 0 || this.reconnectTimer !== null) return;
    const baseDelay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    const delay = baseDelay * (0.5 + Math.random() * 0.5);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatWatchdog.reset();
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatWatchdog.isTimedOut()) {
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        this.socket?.close(4000, 'heartbeat_timeout');
        return;
      }
      this.heartbeatWatchdog.recordPing();
      this.send('ping', { at: Date.now() });
    }, HEARTBEAT_MS);
  }

  private openSocket(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    const generation = ++this.openGeneration;
    const socket = new WebSocket(wsUrl());
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || generation !== this.openGeneration) return;
      this.connectionEpoch += 1;
      this.reconnectAttempt = 0;
      this.send('hello', {});
      // Restore handlers replay subscriptions lost with the previous socket.
      // On the very first open the originals are still sitting in the
      // outbound queue, so replaying would double-send them.
      if (this.everConnected) {
        for (const restore of this.restoreHandlers) restore(this.connectionEpoch);
      }
      this.everConnected = true;
      this.flushQueue();
      this.startHeartbeat();
      this.emitState(true);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || generation !== this.openGeneration) return;
      let envelope: ServerEnvelope | null = null;
      try {
        envelope = JSON.parse(String(event.data)) as ServerEnvelope;
      } catch {
        return;
      }
      const parsed = parseRealtimeEvent(envelope);
      if (parsed?.type === 'pong') this.heartbeatWatchdog.recordPong();
      if (parsed) this.emit(parsed);
    };
    socket.onclose = () => {
      if (this.socket !== socket || generation !== this.openGeneration) return;
      this.clearTimers();
      this.socket = null;
      this.emitState(false);
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  onRestore(handler: (connectionEpoch: number) => void): () => void {
    this.restoreHandlers.add(handler);
    return () => {
      this.restoreHandlers.delete(handler);
    };
  }

  // Connection liveness for UI indicators: true on socket open, false on loss.
  onStateChange(handler: (connected: boolean, connectionEpoch: number) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  private emitState(connected: boolean): void {
    for (const handler of this.stateHandlers) handler(connected, this.connectionEpoch);
  }

  getConnectionEpoch(): number {
    return this.connectionEpoch;
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  ensureConnected(): void {
    if (isDesktopBoundaryBlocked()) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByClient = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openSocket();
  }

  private disconnect(): void {
    this.closedByClient = true;
    this.openGeneration += 1;
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

// --- Shared music commands ------------------------------------------------
// Every wrapper builds its frame through `normalizeMusicCommand` from the shared
// contract rather than by hand, so a client can never put a shape on the wire
// that the server would reject. A `false` return means the input did not
// normalize (e.g. a link that is not a supported VK Video, Rutube or YouTube
// link) and nothing was sent.
// `normalizeMusicCommand` deliberately ignores `roomId`: room scoping,
// authorship and the static-room rule are decided on the server.

function sendMusicCommand(roomId: string, command: Record<string, unknown> & { type: string }): boolean {
  const room = String(roomId || '').trim();
  if (!room) return false;
  const { type, ...payload } = command;
  getAppRealtime().send(type, { roomId: room, ...payload });
  return true;
}

export function enqueueRoomMusic(roomId: string, link: string): boolean {
  const command = normalizeMusicCommand('room.music.enqueue', { link });
  return command ? sendMusicCommand(roomId, command) : false;
}

export function enqueueRoomMusicTrackRef(roomId: string, trackRef: MusicTrackRef): boolean {
  const command = normalizeMusicCommand('room.music.enqueue', { trackRef });
  return command ? sendMusicCommand(roomId, command) : false;
}

/** `itemId === null` skips whatever is currently playing. */
export function skipRoomMusic(roomId: string, itemId: string | null = null): boolean {
  const command = normalizeMusicCommand('room.music.skip', { itemId });
  return command ? sendMusicCommand(roomId, command) : false;
}

export function removeRoomMusicItem(roomId: string, itemId: string): boolean {
  const command = normalizeMusicCommand('room.music.remove', { itemId });
  return command ? sendMusicCommand(roomId, command) : false;
}

export function stopRoomMusic(roomId: string): boolean {
  const command = normalizeMusicCommand('room.music.stop', {});
  return command ? sendMusicCommand(roomId, command) : false;
}

export function connectRealtime(onEvent: (event: RealtimeEvent) => void): RealtimeHandle {
  const conn = getAppRealtime();
  const unsubscribe = conn.subscribe(onEvent);
  return {
    close: unsubscribe,
    send: (type, payload = {}) => conn.send(type, payload)
  };
}
