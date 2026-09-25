// What the room layer sends a voice peer, in the older in-process spelling,
// and its WebSocket event. Every RoomPeerMessage has an event: a transport
// that could not map a message would report a failed send and the peer
// would be dropped as lost.

import type { ServerEvents } from '@voice-room/shared/contracts/realtime';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { buildServerEnvelope } from './envelope.ts';

type Tagged<Type extends string, Fields> = { type: Type } & Fields;

export type RoomPeerMessage =
  | Tagged<'ping', ServerEvents['pong']>
  | Tagged<'peer-joined' | 'peer-updated', Pick<ServerEvents['room.peer.joined'], 'peer'>>
  | Tagged<'peer-left', { peerId: string; reason?: string }>
  | Tagged<'room-updated', ServerEvents['room.updated']>
  | Tagged<'room-deleted', ServerEvents['room.deleted']>
  | Tagged<'room-not-found', { roomId?: string }>
  | Tagged<'room-full', Pick<ServerEvents['room.full'], 'maxRoomPeers'>>
  | Tagged<'room.kicked' | 'room.banned', { roomId?: string; peerId?: string }>
  | Tagged<'chat-message', Pick<ServerEvents['room.chat.message'], 'message'>>
  | Tagged<'reaction.updated', { payload: ServerEvents['reaction.updated'] }>;

function legacyPeerMessageToWs(message: RoomPeerMessage, roomId: string): ServerEnvelope {
  switch (message.type) {
    case 'ping':
      return buildServerEnvelope('pong', { at: message.at });
    case 'peer-joined':
      return buildServerEnvelope('room.peer.joined', { roomId, peer: message.peer });
    case 'peer-left':
      return buildServerEnvelope('room.peer.left', {
        roomId,
        peerId: message.peerId,
        reason: message.reason || 'left'
      });
    case 'peer-updated':
      return buildServerEnvelope('room.peer.updated', { roomId, peer: message.peer });
    case 'room-updated':
      return buildServerEnvelope('room.updated', { room: message.room });
    case 'room-deleted':
      return buildServerEnvelope('room.deleted', { roomId: message.roomId });
    case 'room-not-found':
      return buildServerEnvelope('room.not_found', { roomId: message.roomId || roomId });
    case 'room-full':
      return buildServerEnvelope('room.full', { roomId, maxRoomPeers: message.maxRoomPeers });
    case 'room.kicked':
    case 'room.banned':
      return buildServerEnvelope(message.type, { roomId: message.roomId || roomId, peerId: message.peerId });
    case 'chat-message':
      return buildServerEnvelope('room.chat.message', { roomId, message: message.message });
    case 'reaction.updated':
      return buildServerEnvelope('reaction.updated', {
        ...message.payload,
        roomId: message.payload.roomId || roomId
      });
  }
}

export { legacyPeerMessageToWs };
