// The in-memory voice roster of every room: who is in it, delivering room
// events to them and to the sockets previewing the room, taking a peer out,
// keeping the durable active/empty marker of each room in step with the
// roster, and recording each finished stay in voice.

import type { PeerLeaveReason } from '@voice-room/shared/contracts/realtime';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import type { Logger } from 'pino';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { publicPeer, type PresencePeer } from '../domains/rooms/room-views.ts';
import type { FinishedVoiceSession, VoiceSessionRepository } from '../domains/rooms/voice-session.repository.ts';
import { buildServerEnvelope } from './envelope.ts';
import type { ConnectionRegistry } from './registry.ts';
import { clearViewedScreenPeerReferences } from './room-runtime.ts';

export interface RosterPeer extends PresencePeer {
  closed?: boolean;
  replaced?: boolean;
}

export interface PresenceRoom {
  id: string;
  peers: Map<string, RosterPeer>;
  updatedAt?: number;
  voiceActiveSince?: number | null;
}

export interface OccupancyStore {
  markRoomActive(roomId: string, at: number): Promise<unknown>;
  markRoomEmpty(roomId: string): Promise<unknown>;
  pruneRooms(now: number): Promise<unknown>;
  getRoom(roomId: string): Promise<unknown>;
}

export interface RoomPresenceDeps {
  store(): OccupancyStore;
  /** The sockets that preview a room: its events reach them besides its peers. */
  sockets: Pick<ConnectionRegistry, 'roomDetailSubscribers' | 'sendToConnection'>;
  /** The realtime runtime once createApiApp built it; summaries go through it. */
  runtime(): { scheduleSummaryBroadcast(roomId: string): void } | null;
  logger(): Pick<Logger, 'error'>;
  occupancyRetry: { baseMs: number; maxMs: number };
  roster: { waitMs: number; pollMs: number };
  /** Where finished stays in voice go; null while no database is installed. */
  sessions?: (() => Pick<VoiceSessionRepository, 'recordSessions'> | null) | undefined;
  now?: (() => number) | undefined;
}

export function createRoomPresence(deps: RoomPresenceDeps) {
  const now = deps.now ?? Date.now;
  const rooms = new Map<string, PresenceRoom>();
  const occupancyQueue = new Map<string, Promise<void>>();
  const occupancyRetries = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>();
  const sessionWrites = new Set<Promise<void>>();
  // Set once the stays still open were recorded at shutdown, so a peer that
  // leaves afterwards is not recorded twice.
  let sessionsClosed = false;

  function room(roomId: string): PresenceRoom {
    let current = rooms.get(roomId);
    if (!current) {
      current = { id: roomId, peers: new Map(), updatedAt: Date.now() };
      rooms.set(roomId, current);
    }
    return current;
  }

  /** Joins a stored room with its live roster (the roster object is shared, not copied). */
  function attach<T extends { id: string; peers?: Map<string, RosterPeer> }>(
    dbRoom: T | null
  ): (T & { peers: Map<string, RosterPeer> }) | null {
    if (!dbRoom) return null;
    const presence = room(dbRoom.id);
    if (dbRoom.peers instanceof Map && dbRoom.peers !== presence.peers) {
      for (const [peerId, peer] of dbRoom.peers) {
        if (!presence.peers.has(peerId)) presence.peers.set(peerId, peer);
      }
    }
    return Object.assign(dbRoom, { peers: presence.peers });
  }

  function clearRetry(roomId: string): void {
    const retry = occupancyRetries.get(roomId);
    if (!retry) return;
    if (retry.timer) clearTimeout(retry.timer);
    occupancyRetries.delete(roomId);
  }

  function scheduleRetry(roomId: string): void {
    const current = occupancyRetries.get(roomId);
    if (current?.timer) return;
    const attempt = (current?.attempt || 0) + 1;
    const delay = Math.min(deps.occupancyRetry.baseMs * 2 ** Math.max(0, attempt - 1), deps.occupancyRetry.maxMs);
    const retry: { attempt: number; timer: ReturnType<typeof setTimeout> | null } = { attempt, timer: null };
    retry.timer = setTimeout(() => {
      if (occupancyRetries.get(roomId) !== retry) return;
      retry.timer = null;
      void queueOccupancy(roomId).catch((error: unknown) => {
        deps
          .logger()
          .error(
            { evt: LOG_EVENTS.ROOM_OCCUPANCY_RETRY_FAILED, err: error },
            'failed to retry room occupancy persistence'
          );
      });
    }, delay);
    retry.timer?.unref?.();
    occupancyRetries.set(roomId, retry);
  }

  // Transitions for one room run one after another, so a late "empty" can
  // never overwrite a newer "active". A failed write retries with backoff.
  function queueOccupancy(roomId: string): Promise<void> {
    const previous = occupancyQueue.get(roomId) || Promise.resolve();
    const transition = previous
      .catch(() => {})
      .then(async () => {
        const current = rooms.get(roomId);
        if (current && current.peers.size > 0) {
          await deps.store().markRoomActive(roomId, current.updatedAt || Date.now());
          return;
        }
        await deps.store().markRoomEmpty(roomId);
      });
    occupancyQueue.set(roomId, transition);
    void transition.then(
      () => {
        if (occupancyQueue.get(roomId) !== transition) return;
        occupancyQueue.delete(roomId);
        clearRetry(roomId);
      },
      () => {
        if (occupancyQueue.get(roomId) !== transition) return;
        occupancyQueue.delete(roomId);
        scheduleRetry(roomId);
      }
    );
    return transition;
  }

  function finishedSession(roomId: string, peer: RosterPeer, leftAt: number): FinishedVoiceSession | null {
    if (!peer.joinedAt) return null;
    const userId = peer.accountUserId || null;
    return {
      roomId,
      userId,
      guestName: userId ? null : peer.name || null,
      guestId: userId ? null : peer.guestId || null,
      client: peer.client ?? null,
      os: peer.os ?? '',
      browser: peer.browser ?? '',
      ip: peer.ip ?? '',
      joinedAt: peer.joinedAt,
      leftAt,
      ...(peer.voice?.minutes.length ? { minutes: [...peer.voice.minutes] } : {})
    };
  }

  // A lost write costs one usage row, so it is logged rather than retried.
  function recordSessions(sessions: FinishedVoiceSession[]): void {
    const repository = deps.sessions?.();
    if (!repository || sessions.length === 0) return;
    const write = repository.recordSessions(sessions).catch((error: unknown) => {
      deps
        .logger()
        .error(
          { evt: LOG_EVENTS.ROOM_VOICE_SESSION_RECORD_FAILED, sessions: sessions.length, err: error },
          'failed to record voice sessions'
        );
    });
    sessionWrites.add(write);
    void write.finally(() => sessionWrites.delete(write));
  }

  /**
   * Records every stay still in the roster as ending now and waits for the
   * writes in flight. The process is stopping: its roster dies with it.
   */
  async function recordOpenSessions(): Promise<void> {
    if (!sessionsClosed) {
      sessionsClosed = true;
      const leftAt = now();
      const open: FinishedVoiceSession[] = [];
      for (const current of rooms.values()) {
        for (const peer of current.peers.values()) {
          const session = finishedSession(current.id, peer, leftAt);
          if (session) open.push(session);
        }
      }
      recordSessions(open);
    }
    await Promise.all([...sessionWrites]);
  }

  // A seat whose socket closed reaches nobody until its reconnect lease ends;
  // that counts as sent, so the seat is kept for the rejoin.
  function sendToPeer(peer: RosterPeer | null | undefined, envelope: ServerEnvelope): boolean {
    const transport = peer?.transport;
    const sent = transport
      ? transport.connection === null || deps.sockets.sendToConnection(transport.connection, envelope)
      : false;
    if (!sent && peer) peer.closed = true;
    return sent;
  }

  // One room event to everyone who follows the room: each peer over its own
  // socket (a peer whose socket fails leaves as lost), then each socket that
  // previews the room without being in its call.
  function publish(roomId: string, envelope: ServerEnvelope, exceptPeerId = ''): void {
    const target = rooms.get(roomId);
    if (target) {
      const failedPeers: RosterPeer[] = [];
      for (const peer of target.peers.values()) {
        if (peer.id !== exceptPeerId && !sendToPeer(peer, envelope)) failedPeers.push(peer);
      }
      for (const peer of failedPeers) closePeer(roomId, peer.id, peer.transport?.id, 'lost');
      if (failedPeers.length > 0) deps.runtime()?.scheduleSummaryBroadcast(roomId);
    }
    for (const connection of deps.sockets.roomDetailSubscribers(roomId)) {
      if (connection.activeVoice?.roomId === roomId || !connection.previewRoomIds.has(roomId)) continue;
      deps.sockets.sendToConnection(connection, envelope);
    }
  }

  function publishClearedScreenViewers(target: PresenceRoom, ownerPeerId: string): void {
    for (const viewer of clearViewedScreenPeerReferences(target, ownerPeerId)) {
      publish(target.id, buildServerEnvelope('room.peer.updated', { roomId: target.id, peer: publicPeer(viewer) }));
    }
  }

  // Only the transport that owns the seat can close it: a replaced tab's late
  // close must not remove its replacement.
  function closePeer(
    roomId: string,
    peerId: string,
    transportId: string | undefined,
    reason: PeerLeaveReason = 'left'
  ): void {
    const target = rooms.get(roomId);
    if (!target) return;
    const current = target.peers.get(peerId);
    if (!current || !transportId || current.transport?.id !== transportId) return;

    current.closed = true;
    target.peers.delete(peerId);
    if (!current.replaced) {
      // A reconnect keeps the seat (and its joinedAt), so this is the end of the stay.
      const session = sessionsClosed ? null : finishedSession(roomId, current, now());
      if (session) recordSessions([session]);
      publishClearedScreenViewers(target, peerId);
      publish(roomId, buildServerEnvelope('room.peer.left', { roomId, peerId, reason }));
      deps.runtime()?.scheduleSummaryBroadcast(roomId);
    }
    if (target.peers.size === 0) {
      // The call ended: reset the in-memory call clock (never persisted).
      target.voiceActiveSince = null;
      void queueOccupancy(roomId).catch((error: unknown) => {
        deps
          .logger()
          .error(
            { evt: LOG_EVENTS.ROOM_OCCUPANCY_PERSIST_FAILED, roomId, err: error },
            'failed to persist room occupancy'
          );
      });
    } else {
      target.updatedAt = Date.now();
    }
  }

  // The client sends its realtime join just before asking for a media token,
  // so admission waits a moment for the join to land.
  async function waitForRosterPeer(
    roomId: string,
    peerId: string,
    timeoutMs = deps.roster.waitMs
  ): Promise<RosterPeer | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const peer = rooms.get(roomId)?.peers?.get(peerId);
      if (peer || Date.now() >= deadline) return peer || null;
      await new Promise((resolve) => setTimeout(resolve, deps.roster.pollMs));
    }
  }

  // Every room known active in memory is reconciled before the durable
  // idle-room sweep. If the database is unavailable the sweep fails closed,
  // so an old empty_since marker cannot delete a live room.
  async function prune(now = Date.now()): Promise<void> {
    const activeRoomIds = [...rooms.entries()]
      .filter(([, current]) => current.peers.size > 0)
      .map(([roomId]) => roomId);
    await Promise.all(activeRoomIds.map((roomId) => queueOccupancy(roomId)));
    await deps.store().pruneRooms(now);
    for (const roomId of [...rooms.keys()]) {
      if (await deps.store().getRoom(roomId)) continue;
      rooms.delete(roomId);
    }
  }

  /** Stops pending occupancy retries (a closing server must not keep timers alive). */
  function clearOccupancyRetries(): void {
    for (const roomId of [...occupancyRetries.keys()]) clearRetry(roomId);
  }

  function reset(): void {
    rooms.clear();
    occupancyQueue.clear();
    clearOccupancyRetries();
    sessionsClosed = false;
  }

  return {
    rooms,
    room,
    attach,
    sendToPeer,
    publish,
    publishClearedScreenViewers,
    closePeer,
    queueOccupancy,
    waitForRosterPeer,
    prune,
    reset,
    clearOccupancyRetries,
    recordOpenSessions,
    peerCount: () => [...rooms.values()].reduce((count, current) => count + current.peers.size, 0)
  };
}

export type RoomPresence = ReturnType<typeof createRoomPresence>;
