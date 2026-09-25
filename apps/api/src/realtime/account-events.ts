// What domain services tell an account's sockets, in the older in-process
// spelling, and its WebSocket event. Services send AccountMessage; only this
// module knows the wire names.

import type { ServerEvents } from '@voice-room/shared/contracts/realtime';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { buildServerEnvelope } from './envelope.ts';

type Tagged<Type extends string, Fields> = { type: Type } & Fields;

export type AccountMessage =
  | Tagged<'presence', ServerEvents['friend.presence']>
  | Tagged<'friend-request', Record<never, never>>
  | Tagged<'friend-accepted' | 'friend-removed', { userId: string }>
  | Tagged<'ring.incoming', ServerEvents['ring.incoming']>
  | Tagged<'user-updated', ServerEvents['friend.updated']>
  | Tagged<'notification-settings-updated', ServerEvents['notification.settings.updated']>
  | Tagged<'dm-message' | 'dm.message.edited' | 'dm-message-edited', ServerEvents['dm.message']>
  | Tagged<'dm-read', ServerEvents['dm.read']>
  | Tagged<'dm.message.deleted' | 'dm-message-deleted', ServerEvents['dm.message.deleted']>
  | Tagged<'notification.dm.message', ServerEvents['notification.dm.message']>
  | Tagged<'notification.room.message', ServerEvents['notification.room.message']>
  | Tagged<'notification.friend.request', ServerEvents['notification.friend.request']>
  | Tagged<'notification.friend.accepted', ServerEvents['notification.friend.accepted']>
  | Tagged<'room.kicked' | 'room.banned', ServerEvents['room.kicked']>
  | Tagged<'account.login.new', ServerEvents['account.login.new']>
  | Tagged<'account.login.resolved', ServerEvents['account.login.resolved']>;

function toWsAccountEvent(message: AccountMessage): ServerEnvelope {
  switch (message.type) {
    case 'presence':
      return buildServerEnvelope('friend.presence', {
        userId: message.userId,
        online: message.online
      });
    case 'friend-request':
      return buildServerEnvelope('friend.request', { direction: 'incoming' });
    case 'friend-accepted':
      return buildServerEnvelope('friend.accepted', { userId: message.userId });
    case 'friend-removed':
      return buildServerEnvelope('friend.removed', { userId: message.userId });
    case 'ring.incoming':
      return buildServerEnvelope('ring.incoming', {
        fromUser: message.fromUser,
        room: message.room,
        expiresAt: message.expiresAt
      });
    case 'user-updated':
      return buildServerEnvelope('friend.updated', { user: message.user });
    case 'notification-settings-updated':
      return buildServerEnvelope('notification.settings.updated', {
        preferences: message.preferences
      });
    case 'dm-message':
      return buildServerEnvelope('dm.message', { message: message.message });
    case 'notification.dm.message':
      return buildServerEnvelope('notification.dm.message', {
        dedupeKey: message.dedupeKey,
        peer: message.peer,
        message: message.message
      });
    case 'notification.room.message':
      return buildServerEnvelope('notification.room.message', {
        dedupeKey: message.dedupeKey,
        room: message.room,
        sender: message.sender,
        message: message.message
      });
    case 'notification.friend.request':
      return buildServerEnvelope('notification.friend.request', {
        dedupeKey: message.dedupeKey,
        requester: message.requester,
        requestId: message.requestId
      });
    case 'notification.friend.accepted':
      return buildServerEnvelope('notification.friend.accepted', {
        dedupeKey: message.dedupeKey,
        user: message.user,
        context: message.context
      });
    case 'dm-read':
      return buildServerEnvelope('dm.read', { userId: message.userId });
    case 'dm.message.deleted':
    case 'dm-message-deleted':
      return buildServerEnvelope('dm.message.deleted', {
        messageId: message.messageId,
        peerUserId: message.peerUserId
      });
    case 'dm.message.edited':
    case 'dm-message-edited':
      return buildServerEnvelope('dm.message.edited', {
        message: message.message
      });
    case 'room.kicked':
    case 'room.banned':
      return buildServerEnvelope(message.type, { roomId: message.roomId, peerId: message.peerId });
    case 'account.login.new':
      return buildServerEnvelope('account.login.new', { alert: message.alert });
    case 'account.login.resolved':
      return buildServerEnvelope('account.login.resolved', {
        alertId: message.alertId,
        resolution: message.resolution
      });
  }
}

export { toWsAccountEvent };
