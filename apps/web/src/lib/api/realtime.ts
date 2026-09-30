// App-level WebSocket at /api/ws: account events, room summaries, preview/detail, voice.

import type {
  ClientCommands,
  ClientCommandType,
  RoomRealtimeSummary,
  RoomSnapshot,
  ServerEvent,
  ServerFrame
} from '@voice-room/shared/contracts/realtime';
import { isRealtimeBlocked } from '$lib/platform/desktop-boundary';
import { RealtimeHeartbeatWatchdog } from './realtime-heartbeat';

/** A refusal from the server, as handlers see it. */
export type RealtimeErrorEvent = { type: 'error'; payload: { code: string; message: string; id?: string } };

/** Every event handlers receive: the server's events plus refusals. */
export type RealtimeEvent = ServerEvent | RealtimeErrorEvent;
export type { RoomRealtimeSummary, RoomSnapshot };

/** Sends one command; the payload must be the one its type carries. */
type Send = <Type extends ClientCommandType>(type: Type, payload: ClientCommands[Type], id?: string) => void;

export interface RealtimeHandle {
  close: () => void;
  send: Send;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const HEARTBEAT_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 30000;
// Mirrors the API close code for sockets whose account session was ended.
const SESSION_ENDED_CLOSE_CODE = 4401;

let shared: AppRealtimeConnection | null = null;

function wsUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1/api/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws`;
}

/**
 * The one place a server frame is trusted to match the realtime contract. A
 * frame without a type is dropped; an error frame becomes an `error` event.
 */
function parseRealtimeEvent(frame: unknown): RealtimeEvent | null {
  const envelope = frame as Partial<ServerFrame> | null;
  if (!envelope || typeof envelope.type !== 'string') return null;
  if (envelope.type === 'error') {
    const error = (envelope as { error?: { code?: string; message?: string } }).error;
    return {
      type: 'error',
      payload: { code: error?.code || 'unknown_error', message: error?.message || 'WebSocket error', id: envelope.id }
    };
  }
  const event = envelope as ServerEvent;
  return { ...event, payload: event.payload ?? {} } as ServerEvent;
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
    if (isRealtimeBlocked()) return () => {};
    this.handlers.add(handler);
    this.refCount += 1;
    this.ensureConnected();
    return () => {
      this.handlers.delete(handler);
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this.disconnect();
    };
  }

  send: Send = (type, payload, id) => {
    if (isRealtimeBlocked()) return;
    const frame = JSON.stringify({ ...(id ? { id } : {}), type, payload });
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.outboundQueue.push(frame);
      this.ensureConnected();
      return;
    }
    this.socket.send(frame);
  };

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
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING))
      return;
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
      let frame: unknown;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = parseRealtimeEvent(frame);
      if (parsed?.type === 'pong') this.heartbeatWatchdog.recordPong();
      if (parsed) this.emit(parsed);
    };
    socket.onclose = (event?: CloseEvent) => {
      if (this.socket !== socket || generation !== this.openGeneration) return;
      this.clearTimers();
      this.socket = null;
      this.emitState(false);
      if (event?.code === SESSION_ENDED_CLOSE_CODE) {
        // The account session behind this socket was ended; reconnecting would
        // only come back as a guest, so hand control to the sign-out flow.
        this.closedByClient = true;
        for (const handler of this.sessionEndedHandlers) handler();
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private sessionEndedHandlers = new Set<() => void>();

  // Fires when the server closed the socket because its account session ended
  // (signed out elsewhere, revoked from another device, password replaced).
  onSessionEnded(handler: () => void): () => void {
    this.sessionEndedHandlers.add(handler);
    return () => {
      this.sessionEndedHandlers.delete(handler);
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
    if (isRealtimeBlocked()) return;
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

export function connectRealtime(onEvent: (event: RealtimeEvent) => void): RealtimeHandle {
  const conn = getAppRealtime();
  const unsubscribe = conn.subscribe(onEvent);
  return {
    close: unsubscribe,
    send: (type, payload) => conn.send(type, payload)
  };
}
