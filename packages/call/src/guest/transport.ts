import type { CallRealtimeEvent, CallTransport, CallTransportFailure, LiveKitCredentials } from '../engine/transport';
import { loadLiveKitClient } from '../livekit-runtime';
import { isErrorCode, RETRYABLE_JOIN_CODES } from '@voiceroom/shared/contracts/errors';
import {
  type ClientCommand,
  type ClientCommands,
  type MediaGrant,
  type ServerFrame,
  type VoiceTarget
} from '@voiceroom/shared/contracts/realtime';
import type { RoomCapabilities } from '@voiceroom/shared/contracts/rooms';
import { parseServerFrame } from '@voiceroom/shared/realtime';
import { shallowRef } from 'vue';

type Socket = Pick<WebSocket, 'readyState' | 'send' | 'close'> & EventTarget;

interface JoinSession {
  input: ClientCommands['room.join'];
  lifetime: AbortController;
  rosterListeners: Set<() => void>;
}

interface PendingMedia {
  input: ClientCommands['room.media.request'];
  finish(grant: MediaGrant): void;
}

const READY_TIMEOUT_MS = 8_000;
const HEARTBEAT_MS = 15_000;
const ROSTER_TIMEOUT_MS = 10_000;
const MEDIA_TIMEOUT_MS = 4_000;
interface GuestTransportOptions {
  status(roomId: string): Promise<{ roomId: string } | null>;
  admit(input: Parameters<CallTransport['requestLiveKitToken']>[0], signal: AbortSignal): Promise<LiveKitCredentials>;
  failure(error: unknown): CallTransportFailure | null;
  message: (code: string) => string;
  joinIdentity?: Pick<ClientCommands['room.join'], 'guestId' | 'clientId'>;
  receiveHostFrame?(frame: ServerFrame, rosterAttached: boolean): boolean;
  onLeave?(): void;
  onPolicyClose?: () => void;
}

class RosterUnavailableError extends Error {
  readonly code = 'not_in_room';
  readonly status = 409;
}

function isSamePeer(left: VoiceTarget, right: VoiceTarget): boolean {
  return left.roomId === right.roomId && left.peerId === right.peerId && left.sessionToken === right.sessionToken;
}

function roomEvent(frame: ServerFrame, message: GuestTransportOptions['message']): CallRealtimeEvent | undefined {
  switch (frame.type) {
    case 'error':
      return {
        type: 'error',
        payload: {
          code: isErrorCode(frame.error.code) ? frame.error.code : '',
          message: message(frame.error.code)
        }
      };
    case 'pong':
    case 'room.snapshot':
    case 'room.not_found':
    case 'room.kicked':
    case 'room.banned':
    case 'room.peer.joined':
    case 'room.peer.left':
    case 'room.peer.updated':
    case 'room.voice.quality':
    case 'room.full':
    case 'server.full':
    case 'room.updated':
    case 'room.deleted':
      return frame;
    default:
      return undefined;
  }
}

function deniedMedia(input: ClientCommands['room.media.request']): MediaGrant {
  return { roomId: input.roomId, kind: input.kind, granted: false, reason: 'server_busy' };
}

export function createGuestTransport(
  path: '/api/meet/ws' | '/api/widget/ws',
  options: GuestTransportOptions,
  { origin = window.location.origin, openSocket = (url: URL): Socket => new WebSocket(url) } = {}
) {
  const endpoint = new URL(path, origin);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

  let socket: Socket | null = null;
  let session: JoinSession | null = null;
  let admissionLifetime = new AbortController();
  let connected = false;
  let connectionEpoch = 0;
  let reconnectAttempts = 0;
  let sequence = 0;
  let joinRequestId = '';
  let resyncRequestId = '';
  let resyncKey = '';
  let unansweredPingAt: number | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let resyncTimer: ReturnType<typeof setTimeout> | undefined;
  let resyncFailureHandler: ((input: { code: string }) => void) | null = null;
  const capabilities = shallowRef<RoomCapabilities | null>(null);
  const rosterAttached = shallowRef(false);
  const roomListeners = new Map<string, Set<(event: CallRealtimeEvent) => void>>();
  const stateListeners = new Set<(connected: boolean, epoch: number) => void>();
  const pendingMedia = new Map<string, PendingMedia>();

  async function waitForRoster(current: JoinSession, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new RosterUnavailableError(options.message('not_in_room'));
    if (rosterAttached.value) return;
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', cancelled);
        current.rosterListeners.delete(ready);
        resolve();
      };
      const cancelled = () => {
        current.rosterListeners.delete(ready);
        reject(new RosterUnavailableError(options.message('not_in_room')));
      };
      current.rosterListeners.add(ready);
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }

  function send(command: ClientCommand): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected) return false;
    socket.send(JSON.stringify(command));
    return true;
  }

  function sendJoin(): boolean {
    if (!session || !connected) return false;
    const id = `join-${++sequence}`;
    if (!send({ id, type: 'room.join', payload: session.input })) return false;
    joinRequestId = id;
    return true;
  }

  function clearResync(): void {
    clearTimeout(resyncTimer);
    resyncRequestId = '';
  }

  function closeSocket(): void {
    const previous = socket;
    socket = null;
    clearTimeout(readyTimer);
    clearInterval(heartbeatTimer);
    clearResync();
    resyncKey = '';
    joinRequestId = '';
    rosterAttached.value = false;
    admissionLifetime.abort();
    admissionLifetime = new AbortController();
    for (const pending of pendingMedia.values()) pending.finish(deniedMedia(pending.input));
    if (previous && previous.readyState < WebSocket.CLOSING) previous.close();
    if (!connected) return;
    connected = false;
    for (const listener of stateListeners) listener(false, connectionEpoch);
  }

  function dropSocket(): void {
    closeSocket();
    if (!session || reconnectTimer !== undefined) return;
    const delay = 400 * 2 ** Math.min(reconnectAttempts++, 3);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function disconnect(relief?: ClientCommands['room.leave']['relief']): void {
    if (session) {
      const { roomId, peerId, sessionToken } = session.input;
      send({ type: 'room.leave', payload: { roomId, peerId, sessionToken, ...(relief?.length ? { relief } : {}) } });
      session.lifetime.abort();
    }
    session = null;
    capabilities.value = null;
    options.onLeave?.();
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    closeSocket();
  }

  function onReady(): void {
    if (connected) return;
    clearTimeout(readyTimer);
    connected = true;
    connectionEpoch += 1;
    unansweredPingAt = null;
    heartbeatTimer = setInterval(() => {
      const at = Date.now();
      if (unansweredPingAt !== null && at - unansweredPingAt >= 2 * HEARTBEAT_MS) {
        dropSocket();
        return;
      }
      if (send({ type: 'ping', payload: { at } })) unansweredPingAt ??= at;
    }, HEARTBEAT_MS);
    sendJoin();
    for (const listener of stateListeners) listener(true, connectionEpoch);
  }

  function receive(frame: ServerFrame): void {
    if (frame.type === 'ready' && frame.payload.guest) {
      onReady();
      return;
    }
    const current = session;
    if (!current || !connected) return;
    const { roomId, peerId } = current.input;
    if (options.receiveHostFrame?.(frame, rosterAttached.value)) return;
    if (frame.type === 'room.media.grant' || (frame.type === 'error' && frame.id?.startsWith('media-'))) {
      const pending = pendingMedia.get(frame.id ?? '');
      if (!pending) return;
      if (
        frame.type === 'room.media.grant' &&
        frame.payload.roomId === roomId &&
        frame.payload.kind === pending.input.kind
      ) {
        pending.finish(frame.payload);
      } else {
        pending.finish(deniedMedia(pending.input));
      }
      return;
    }
    if (frame.type === 'error') {
      const { code } = frame.error;
      if (frame.id && frame.id !== joinRequestId) return;
      joinRequestId = '';
      if (frame.id && frame.id === resyncRequestId) {
        clearResync();
        resyncFailureHandler?.({ code });
        return;
      }
      if (isErrorCode(code) && RETRYABLE_JOIN_CODES.has(code)) {
        dropSocket();
        return;
      }
    } else if ('roomId' in frame.payload && frame.payload.roomId !== roomId) {
      return;
    }
    if (frame.type === 'room.snapshot') {
      if (
        frame.id !== joinRequestId ||
        frame.payload.mode !== 'active' ||
        !frame.payload.peers.some((peer) => peer.id === peerId)
      )
        return;
      joinRequestId = '';
      clearResync();
      reconnectAttempts = 0;
      rosterAttached.value = true;
      for (const listener of current.rosterListeners) listener();
    }
    if (frame.type === 'pong') {
      unansweredPingAt = null;
      if (!rosterAttached.value) return;
    }
    const event = roomEvent(frame, options.message);
    if (event) for (const listener of roomListeners.get(roomId) ?? []) listener(event);
  }

  function connect(): void {
    if (socket || reconnectTimer !== undefined) return;
    let next: Socket;
    try {
      next = openSocket(endpoint);
    } catch {
      dropSocket();
      return;
    }
    socket = next;
    readyTimer = setTimeout(dropSocket, READY_TIMEOUT_MS);
    next.addEventListener('close', (event) => {
      if (socket !== next) return;
      if (event instanceof CloseEvent && event.code === 1008 && options.onPolicyClose) {
        disconnect();
        options.onPolicyClose();
        return;
      }
      dropSocket();
    });
    next.addEventListener('message', (event: Event) => {
      if (socket !== next || !('data' in event) || typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const decoded = parseServerFrame(raw);
      if (decoded.ok) receive(decoded.frame);
    });
  }

  const realtime: CallTransport['realtime'] = {
    ensureConnected: connect,
    isConnected: () => connected,
    getConnectionEpoch: () => connectionEpoch,
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeRoom(roomId, handler) {
      const listeners = roomListeners.get(roomId) ?? new Set();
      roomListeners.set(roomId, listeners);
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
        if (!listeners.size) roomListeners.delete(roomId);
      };
    },
    join(input) {
      if (session) disconnect();
      session = {
        input: { ...input, ...options.joinIdentity },
        lifetime: new AbortController(),
        rosterListeners: new Set()
      };
      if (!sendJoin()) connect();
    },
    leave(payload) {
      if (!session || !isSamePeer(session.input, payload)) return;
      disconnect(payload.relief);
    },
    updatePeer(payload) {
      if (session && rosterAttached.value && isSamePeer(session.input, payload))
        send({ type: 'room.peer.update', payload });
    },
    reportPoll(payload) {
      if (session && rosterAttached.value && isSamePeer(session.input, payload))
        send({ type: 'room.voice.report', payload });
    },
    requestMediaGrant(input) {
      if (!session || !rosterAttached.value || !isSamePeer(session.input, input) || !connected)
        return Promise.resolve(deniedMedia(input));
      const id = `media-${++sequence}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(deniedMedia(input)), MEDIA_TIMEOUT_MS);
        function finish(grant: MediaGrant): void {
          clearTimeout(timer);
          pendingMedia.delete(id);
          resolve(grant);
        }
        pendingMedia.set(id, { input, finish });
        if (!send({ id, type: 'room.media.request', payload: input })) finish(deniedMedia(input));
      });
    },
    requestResync(recoveryEpoch, appEpoch, fresh) {
      if (!session || !connected || connectionEpoch !== appEpoch) return false;
      const key = `${recoveryEpoch}:${appEpoch}`;
      if (!fresh && key === resyncKey) return Boolean(resyncRequestId);
      if ((fresh || !joinRequestId) && !sendJoin()) return false;
      clearResync();
      resyncKey = key;
      resyncRequestId = joinRequestId;
      resyncTimer = setTimeout(() => {
        clearResync();
        joinRequestId = '';
        resyncFailureHandler?.({ code: 'transport_error' });
      }, MEDIA_TIMEOUT_MS);
      return true;
    },
    setResyncFailureHandler(handler) {
      resyncFailureHandler = handler;
      if (!handler) clearResync();
    }
  };

  return {
    realtime,
    disconnect,
    capabilities,
    rosterAttached,
    send,
    async roomStatus(roomId: string) {
      const found = await options.status(roomId);
      return found ? { name: '', avatarUrl: '', isStatic: false } : null;
    },
    async requestLiveKitToken(input: Parameters<CallTransport['requestLiveKitToken']>[0]): Promise<LiveKitCredentials> {
      const current = session;
      if (!current || !isSamePeer(current.input, input))
        throw new RosterUnavailableError(options.message('not_in_room'));
      await waitForRoster(current, AbortSignal.any([current.lifetime.signal, AbortSignal.timeout(ROSTER_TIMEOUT_MS)]));
      if (current !== session || !rosterAttached.value)
        throw new RosterUnavailableError(options.message('not_in_room'));
      // A replacement socket keeps the guest identity but needs a fresh roster before admission.
      const signal = AbortSignal.any([current.lifetime.signal, admissionLifetime.signal]);
      try {
        const admission = await options.admit(input, signal);
        signal.throwIfAborted();
        // The SDK logs the signaling URL at connection time, including the gate credential.
        const { setLogLevel } = await loadLiveKitClient();
        signal.throwIfAborted();
        setLogLevel('silent');
        capabilities.value = admission.capabilities ?? null;
        return admission;
      } catch (error) {
        if (signal.aborted) throw new RosterUnavailableError(options.message('not_in_room'));
        throw error;
      }
    },
    failure: (error: unknown) => (error instanceof RosterUnavailableError ? error : options.failure(error))
  };
}
