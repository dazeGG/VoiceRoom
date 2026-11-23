import { randomUUID } from 'node:crypto';
import { MEET_CHAT_MAX_BYTES } from '@voiceroom/shared/contracts/realtime';
import { cleanName } from '@voiceroom/shared/validation';
import { roomAllowsEphemeralChat } from '../domains/rooms/room-surface.policy.ts';
import { createRateLimiter } from '../lib/rate-limit.ts';
import { buildServerEnvelope } from './envelope.ts';
import type { ConnectionRegistry, WsConnection } from './registry.ts';
import type { PresenceRoom, RosterPeer } from './room-presence.ts';

const WINDOW_MS = 10_000;

function attachedConnection(roomId: string, peer: RosterPeer | undefined): WsConnection | null {
  if (!peer || peer.closed || peer.replaced) return null;
  const transport = peer.transport;
  const connection = transport?.connection;
  const seat = connection?.activeVoice;
  if (
    !connection ||
    connection.closed ||
    !connection.guest ||
    connection.roomSurface !== 'meet' ||
    connection.socket.readyState !== 1 ||
    seat?.roomId !== roomId ||
    seat.peerId !== peer.id ||
    seat.transportId !== transport.id
  ) {
    return null;
  }
  return connection;
}

export function createMeetChat(
  rooms: ReadonlyMap<string, PresenceRoom>,
  sockets: Pick<ConnectionRegistry, 'sendToConnection'>,
  now = Date.now
) {
  const principalBudget = createRateLimiter({ limit: 8, windowMs: WINDOW_MS });
  const roomBudget = createRateLimiter({ limit: 40, windowMs: WINDOW_MS });

  return (connection: WsConnection, rawText: string) => {
    const seat = connection.activeVoice;
    const room = seat && rooms.get(seat.roomId);
    if (!room || !roomAllowsEphemeralChat(room)) return 'forbidden';
    const peer = room.peers.get(seat.peerId);
    if (!peer?.gateGuestPrincipalId || attachedConnection(room.id, peer) !== connection) return 'forbidden';

    const text = rawText.trim();
    if (!text || Buffer.byteLength(rawText, 'utf8') > MEET_CHAT_MAX_BYTES) return 'invalid_request';

    const at = now();
    if (!principalBudget.check(peer.gateGuestPrincipalId, at).allowed || !roomBudget.check(room.id, at).allowed) {
      return 'rate_limited';
    }

    const event = buildServerEnvelope('meet.chat.message', {
      id: randomUUID(),
      authorId: peer.id,
      displayName: cleanName(peer.name),
      text
    });
    for (const recipient of room.peers.values()) {
      const target = attachedConnection(room.id, recipient);
      if (target) sockets.sendToConnection(target, event);
    }
    return null;
  };
}

export type MeetChat = ReturnType<typeof createMeetChat>;
