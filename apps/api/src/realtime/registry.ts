import crypto from 'node:crypto';
import { cleanPresenceStatus } from '@voice-room/shared/validation';
import type { PresenceStatus } from '@voice-room/shared/validation';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { buildServerEnvelope, sendWsEnvelope } from './envelope.ts';
import { toWsAccountEvent } from './account-events.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';

export type RealtimeSocket = { readyState: number; send(data: string): void; close(code?: number, reason?: string): void };
export type ActiveVoice = { roomId: string; [key: string]: any };
export type WsConnection = {
  id: string;
  userId: string | null;
  guest: boolean;
  authSessionHash: string;
  clientIp: string;
  guestIp: string | null;
  socket: RealtimeSocket;
  presenceStatus: PresenceStatus;
  previewRoomIds: Set<string>;
  activeVoice: ActiveVoice | null;
  pendingVoiceJoin: any;
  inboundMessageQueue: Promise<unknown>;
  lastHeartbeatAt: number;
  openedAt: number;
  closed: boolean;
  [key: string]: any;
};
type PresenceEntry = { inVoice: boolean; roomId: string | null; presenceStatus: string };
type PresenceRegistry = {
  userConnections?: Map<string, Set<WsConnection>>;
  userPresenceStatuses: Map<string, string>;
  getPresenceRevision?: () => number;
};
type PresenceRoom = { updatedAt?: unknown; peers?: { values?: () => Iterable<{ accountUserId?: string | null }> } } | null | undefined;
type RegistryLogger = { error(...args: unknown[]): void };

function createConnectionId(prefix: string): string {
  return `${prefix}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
}

function buildRoomMembershipPresenceSnapshot(roomId: string, room: PresenceRoom, registry: PresenceRegistry | null | undefined) {
  const byUserId = new Map<string, PresenceEntry[]>();
  for (const [userId, userConnections] of registry?.userConnections || []) {
    const entries: PresenceEntry[] = [];
    for (const connection of userConnections) {
      entries.push({
        inVoice: connection.activeVoice?.roomId === roomId,
        roomId: connection.activeVoice?.roomId || null,
        presenceStatus: connection.presenceStatus || registry!.userPresenceStatuses.get(userId) || 'online'
      });
    }
    if (entries.length) byUserId.set(userId, entries);
  }
  for (const peer of room?.peers?.values?.() || []) {
    if (!peer.accountUserId) continue;
    const entries = byUserId.get(peer.accountUserId) || [];
    entries.push({ inVoice: true, roomId, presenceStatus: 'online' });
    byUserId.set(peer.accountUserId, entries);
  }
  return {
    byUserId,
    revision: Math.max(Number(room?.updatedAt) || 0, registry?.getPresenceRevision?.() || 0)
  };
}

function createConnectionRegistry({
  maxConnectionsPerUser,
  maxGuestConnectionsPerIp = 0,
  keepaliveMs,
  onPresenceChange,
  onConnectionClose,
  getFriendIds,
  logger = createLogger({ name: 'api' })
}: {
  maxConnectionsPerUser: number;
  maxGuestConnectionsPerIp?: number;
  keepaliveMs: number;
  onPresenceChange?: ((friendId: string, userId: string, online: boolean) => void) | null;
  onConnectionClose?: ((connection: WsConnection) => void) | null;
  getFriendIds: (userId: string) => Promise<string[]>;
  logger?: RegistryLogger;
}) {
  const userConnections = new Map<string, Set<WsConnection>>();
  const userPresenceStatuses = new Map<string, PresenceStatus>();
  const guestConnectionsByIp = new Map<string, Set<WsConnection>>();
  const roomDetailConnections = new Map<string, Set<WsConnection>>();
  const connections = new Map<string, WsConnection>();
  let presenceRevision = 0;

  function bumpPresenceRevision(): void {
    presenceRevision = Math.max(Date.now(), presenceRevision + 1);
  }

  function connectionCount(userId: string | null | undefined): number {
    if (!userId) return 0;
    const set = userConnections.get(userId);
    return set ? set.size : 0;
  }

  function isUserOnline(userId: string): boolean {
    return connectionCount(userId) > 0 && userPresenceStatuses.get(userId) !== 'offline';
  }

  function createConnectionRecord(userId: string | null, socket: RealtimeSocket, clientIp = '', presenceStatus: unknown = 'online', authSessionHash: unknown = ''): WsConnection {
    return {
      id: createConnectionId(userId || 'guest'),
      userId: userId || null,
      guest: !userId,
      authSessionHash: userId ? String(authSessionHash || '') : '',
      clientIp: clientIp || '',
      guestIp: null,
      socket,
      presenceStatus: cleanPresenceStatus(presenceStatus) || 'online',
      previewRoomIds: new Set<string>(),
      activeVoice: null,
      pendingVoiceJoin: null,
      inboundMessageQueue: Promise.resolve(),
      lastHeartbeatAt: Date.now(),
      openedAt: Date.now(),
      closed: false
    };
  }

  function addConnection(userId: string, socket: RealtimeSocket, clientIp = '', presenceStatus: unknown = 'online', authSessionHash: unknown = ''): WsConnection {
    let set = userConnections.get(userId);
    const wasOffline = !isUserOnline(userId);
    if (!set) {
      set = new Set<WsConnection>();
      userConnections.set(userId, set);
    }
    if (!userPresenceStatuses.has(userId)) {
      userPresenceStatuses.set(userId, cleanPresenceStatus(presenceStatus) || 'online');
    }
    const activePresenceStatus = userPresenceStatuses.get(userId);
    const connection = createConnectionRecord(userId, socket, clientIp, activePresenceStatus, authSessionHash);
    set.add(connection);
    connections.set(connection.id, connection);
    bumpPresenceRevision();

    if (wasOffline && isUserOnline(userId)) {
      void notifyFriendsPresence(userId, true);
    }

    return connection;
  }

  function addGuestConnection(socket: RealtimeSocket, guestIp = 'unknown'): WsConnection {
    const connection = createConnectionRecord(null, socket, guestIp);
    connection.guestIp = guestIp || 'unknown';
    let set = guestConnectionsByIp.get(connection.guestIp);
    if (!set) {
      set = new Set<WsConnection>();
      guestConnectionsByIp.set(connection.guestIp, set);
    }
    set.add(connection);
    connections.set(connection.id, connection);
    return connection;
  }

  async function notifyFriendsPresence(userId: string, online: boolean): Promise<void> {
    if (!onPresenceChange || !userId) return;
    let friendIds: string[] = [];
    try {
      friendIds = await getFriendIds(userId);
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.WS_PRESENCE_FRIENDS_LOAD_FAILED, userId, online, err: error }, 'failed to load friends for a presence change');
      return;
    }
    for (const friendId of friendIds) {
      onPresenceChange!(friendId, userId, online);
    }
  }

  function setUserPresenceStatus(userId: string, presenceStatus: unknown): boolean {
    const normalizedPresenceStatus = cleanPresenceStatus(presenceStatus);
    const set = userConnections.get(userId);
    if (!normalizedPresenceStatus || !set || set.size === 0) return false;

    const wasOnline = isUserOnline(userId);
    const previousPresenceStatus = userPresenceStatuses.get(userId);
    userPresenceStatuses.set(userId, normalizedPresenceStatus);
    for (const connection of set) connection.presenceStatus = normalizedPresenceStatus;
    if (previousPresenceStatus !== normalizedPresenceStatus) bumpPresenceRevision();
    const online = isUserOnline(userId);
    if (online !== wasOnline) void notifyFriendsPresence(userId, online);
    return online;
  }

  function removeConnection(connection: WsConnection | null | undefined): void {
    if (!connection || connection.closed) return;
    connection.closed = true;

    if (onConnectionClose) {
      onConnectionClose(connection);
    }

    unregisterConnectionFromAllRooms(connection);

    if (connection.userId) {
      const wasOnline = isUserOnline(connection.userId);
      const set = userConnections.get(connection.userId);
      if (set) {
        set.delete(connection);
        if (set.size === 0) userConnections.delete(connection.userId);
      }
      bumpPresenceRevision();
      const stillOnline = isUserOnline(connection.userId);
      if (wasOnline && !stillOnline) {
        void notifyFriendsPresence(connection.userId, false);
      }
      if (!userConnections.has(connection.userId)) userPresenceStatuses.delete(connection.userId);
    } else if (connection.guestIp) {
      const set = guestConnectionsByIp.get(connection.guestIp);
      if (set) {
        set.delete(connection);
        if (set.size === 0) guestConnectionsByIp.delete(connection.guestIp);
      }
    }

    connections.delete(connection.id);
  }

  function sendToConnection(connection: WsConnection, envelope: ServerEnvelope): boolean {
    return sendWsEnvelope(connection.socket, envelope);
  }

  function sendToUser(userId: string, envelope: ServerEnvelope): number {
    const set = userConnections.get(userId);
    if (!set || set.size === 0) return 0;
    let delivered = 0;
    const failed: WsConnection[] = [];
    for (const connection of set) {
      // Do not touch lastHeartbeatAt here: a successful send only means the
      // frame was queued locally, not that the client is alive. Liveness is
      // tracked from inbound ping/hello frames so pruneStale can reap
      // half-open sockets that still accept writes.
      if (sendToConnection(connection, envelope)) {
        delivered += 1;
      } else {
        failed.push(connection);
      }
    }
    for (const connection of failed) removeConnection(connection);
    return delivered;
  }

  function broadcastAccountEvent(userId: string, legacyMessage: Parameters<typeof toWsAccountEvent>[0]): number {
    const wsEvent = toWsAccountEvent(legacyMessage);
    if (!wsEvent) return 0;
    return sendToUser(userId, wsEvent);
  }

  function sendReady(connection: WsConnection, payload: Parameters<typeof buildServerEnvelope>[1]): boolean {
    return sendToConnection(connection, buildServerEnvelope('ready', payload));
  }

  function rejectOverLimit(userId: string): boolean {
    return connectionCount(userId) >= maxConnectionsPerUser;
  }

  function guestConnectionCount(guestIp: string | null | undefined): number {
    const set = guestConnectionsByIp.get(guestIp || 'unknown');
    return set ? set.size : 0;
  }

  function rejectGuestOverLimit(guestIp: string | null | undefined): boolean {
    return maxGuestConnectionsPerIp > 0 && guestConnectionCount(guestIp) >= maxGuestConnectionsPerIp;
  }

  function registerConnectionForRoom(connection: WsConnection | null | undefined, roomId: string | null | undefined): void {
    if (!connection || !roomId) return;
    let set = roomDetailConnections.get(roomId);
    if (!set) {
      set = new Set<WsConnection>();
      roomDetailConnections.set(roomId, set);
    }
    set.add(connection);
  }

  function unregisterConnectionForRoom(connection: WsConnection, roomId: string): void {
    const set = roomDetailConnections.get(roomId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) roomDetailConnections.delete(roomId);
  }

  function unregisterConnectionFromAllRooms(connection: WsConnection): void {
    for (const roomId of connection.previewRoomIds || []) {
      unregisterConnectionForRoom(connection, roomId);
    }
    if (connection.activeVoice?.roomId) unregisterConnectionForRoom(connection, connection.activeVoice.roomId);
  }

  function roomDetailSubscribers(roomId: string): Set<WsConnection> {
    return roomDetailConnections.get(roomId) || new Set<WsConnection>();
  }

  function touch(connection: WsConnection): void {
    connection.lastHeartbeatAt = Date.now();
  }

  // Sockets authenticated by account sessions that were just ended. Without a
  // hash list this selects every socket of the account (password replaced);
  // without an account id the hashes are matched across all signed-in sockets.
  function findAccountConnections(userId: string | null | undefined, tokenHashes: unknown[] | null = null): WsConnection[] {
    const wanted = Array.isArray(tokenHashes) ? new Set(tokenHashes.filter(Boolean)) : null;
    const candidates = userId ? userConnections.get(userId) : wanted ? connections.values() : null;
    if (!candidates) return [];
    return [...candidates].filter((connection) => !connection.guest && (!wanted || wanted.has(connection.authSessionHash)));
  }

  function closeConnections(targets: Iterable<WsConnection>, code = 4401, reason = 'Session revoked'): void {
    for (const connection of targets) {
      try {
        connection.socket.close(code, reason);
      } catch {
        // The socket may already be gone; the registry entry still has to go.
      }
      removeConnection(connection);
    }
  }

  function pruneStale(now: number = Date.now()): void {
    const stale: WsConnection[] = [];
    // 5x keepalive: background tabs throttle timers, so a healthy client's
    // ping interval can stretch to ~60s; 3x (45s) would reap live tabs.
    for (const connection of connections.values()) {
      if (now - connection.lastHeartbeatAt > keepaliveMs * 5) stale.push(connection);
    }
    for (const connection of stale) {
      try {
        connection.socket.close(4000, 'Stale connection');
      } catch {
        // Ignore close failures during prune.
      }
      removeConnection(connection);
    }
  }

  return {
    addConnection,
    addGuestConnection,
    broadcastAccountEvent,
    closeConnections,
    connectionCount,
    connections,
    findAccountConnections,
    getPresenceRevision: () => presenceRevision,
    isUserOnline,
    removeConnection,
    registerConnectionForRoom,
    rejectGuestOverLimit,
    rejectOverLimit,
    roomDetailSubscribers,
    sendReady,
    sendToConnection,
    sendToUser,
    setUserPresenceStatus,
    touch,
    pruneStale,
    unregisterConnectionForRoom,
    unregisterConnectionFromAllRooms,
    userConnections,
    userPresenceStatuses
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;

export { buildRoomMembershipPresenceSnapshot, createConnectionRegistry };
