// The in-memory voice roster of every room: who is in it, delivering legacy
// room events to them, taking a peer out, and keeping the durable
// active/empty marker of each room in step with the roster.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../lib/log-events.js';
import { publicPeer, type PresencePeer } from '../domains/rooms/room-views.ts';
import { clearViewedScreenPeerReferences } from './room-runtime.js';

export interface RosterPeer extends PresencePeer {
  closed?: boolean;
  replaced?: boolean;
  transport?: { id?: string; send(message: unknown): boolean } | null;
}

export interface PresenceRoom {
  id: string;
  peers: Map<string, RosterPeer>;
  updatedAt: number;
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
  /** The realtime runtime once createApiApp built it; preview watchers and summaries go through it. */
  runtime(): { scheduleSummaryBroadcast(roomId: string): void; mirrorLegacyRoomEvent(roomId: string, message: unknown): void } | null;
  logger(): Pick<Logger, 'error'>;
  occupancyRetry: { baseMs: number; maxMs: number };
  roster: { waitMs: number; pollMs: number };
}

export function createRoomPresence(deps: RoomPresenceDeps) {
  const rooms = new Map<string, PresenceRoom>();
  const occupancyQueue = new Map<string, Promise<void>>();
  const occupancyRetries = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>();

  function room(roomId: string): PresenceRoom {
    let current = rooms.get(roomId);
    if (!current) {
      current = { id: roomId, peers: new Map(), updatedAt: Date.now() };
      rooms.set(roomId, current);
    }
    return current;
  }

  /** Joins a stored room with its live roster (the roster object is shared, not copied). */
  function attach<T extends { id: string; peers?: unknown }>(dbRoom: T | null): (T & { peers: Map<string, RosterPeer> }) | null {
    if (!dbRoom) return null;
    const presence = room(dbRoom.id);
    if (dbRoom.peers instanceof Map && dbRoom.peers !== presence.peers) {
      for (const [peerId, peer] of dbRoom.peers as Map<string, RosterPeer>) {
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
      void queueOccupancy(roomId).catch((error) => {
        deps.logger().error({ evt: LOG_EVENTS.ROOM_OCCUPANCY_RETRY_FAILED, err: error }, 'failed to retry room occupancy persistence');
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

  function sendEvent(peer: RosterPeer | null | undefined, message: unknown): boolean {
    const sent = peer?.transport?.send(message) ?? false;
    if (!sent && peer) peer.closed = true;
    return sent;
  }

  // Delivers a legacy room event to active peers over their own transports.
  // Preview-only subscribers are reached through mirrorLegacyRoomEvent at
  // each call site, so nothing is delivered twice.
  function broadcast(target: PresenceRoom, message: unknown, exceptPeerId = ''): void {
    const failedPeers: RosterPeer[] = [];
    for (const peer of target.peers.values()) {
      if (peer.id !== exceptPeerId && !sendEvent(peer, message)) failedPeers.push(peer);
    }
    for (const peer of failedPeers) closePeer(target.id, peer.id, peer.transport?.id, 'lost');
    if (failedPeers.length > 0) deps.runtime()?.scheduleSummaryBroadcast(target.id);
  }

  function publishClearedScreenViewers(target: PresenceRoom, ownerPeerId: string): void {
    for (const viewer of clearViewedScreenPeerReferences(target, ownerPeerId) as RosterPeer[]) {
      const message = { type: 'peer-updated', peer: publicPeer(viewer) };
      broadcast(target, message);
      deps.runtime()?.mirrorLegacyRoomEvent(target.id, message);
    }
  }

  // Only the transport that owns the seat can close it: a replaced tab's late
  // close must not remove its replacement.
  function closePeer(roomId: string, peerId: string, transportId: string | undefined, reason = 'left'): void {
    const target = rooms.get(roomId);
    if (!target) return;
    const current = target.peers.get(peerId);
    if (!current || !transportId || current.transport?.id !== transportId) return;

    current.closed = true;
    target.peers.delete(peerId);
    if (!current.replaced) {
      publishClearedScreenViewers(target, peerId);
      broadcast(target, { type: 'peer-left', peerId, reason });
      deps.runtime()?.mirrorLegacyRoomEvent(roomId, { type: 'peer-left', peerId, reason });
      deps.runtime()?.scheduleSummaryBroadcast(roomId);
    }
    if (target.peers.size === 0) {
      // The call ended: reset the in-memory call clock (never persisted).
      target.voiceActiveSince = null;
      void queueOccupancy(roomId).catch((error) => {
        deps.logger().error({ evt: LOG_EVENTS.ROOM_OCCUPANCY_PERSIST_FAILED, roomId, err: error }, 'failed to persist room occupancy');
      });
    } else {
      target.updatedAt = Date.now();
    }
  }

  // The client sends its realtime join just before asking for a media token,
  // so admission waits a moment for the join to land.
  async function waitForRosterPeer(roomId: string, peerId: string, timeoutMs = deps.roster.waitMs): Promise<RosterPeer | null> {
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
    const activeRoomIds = [...rooms.entries()].filter(([, current]) => current.peers.size > 0).map(([roomId]) => roomId);
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
  }

  return {
    rooms,
    room,
    attach,
    sendEvent,
    broadcast,
    publishClearedScreenViewers,
    closePeer,
    queueOccupancy,
    waitForRosterPeer,
    prune,
    reset,
    clearOccupancyRetries,
    peerCount: () => [...rooms.values()].reduce((count, current) => count + current.peers.size, 0)
  };
}

export type RoomPresence = ReturnType<typeof createRoomPresence>;
