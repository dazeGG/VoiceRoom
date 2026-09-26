// What one room says to the sockets watching it: the room detail stream
// (chat, edits, peer events for preview watchers), typing notices, and the
// bell notification a new message raises for the room's other members.

import type { RoomMessage } from '@voice-room/shared/contracts/messages';
import type { TypingActivity, ServerEnvelope } from '@voice-room/shared/realtime';
import { cleanName } from '@voice-room/shared/validation';
import { LOG_EVENTS } from '../lib/log-events.ts';
import type { StoredUser, UserStore } from '../lib/user-store.ts';
import type { RoomChatMessage } from '../domains/messaging/room-chat-views.ts';
import type { AccountMessage } from './account-events.ts';
import { buildServerEnvelope } from './envelope.ts';
import { legacyPeerMessageToWs, type RoomPeerMessage } from './legacy-events.ts';
import type { ConnectionRegistry, WsConnection } from './registry.ts';
import { createTypingThrottle } from './typing-throttle.ts';
import type { PresenceRoom, RuntimeLogger, RuntimeRoomStore } from './runtime-types.ts';

export interface RoomFanoutDeps {
  presenceRooms: Map<string, PresenceRoom>;
  wsRegistry: Pick<ConnectionRegistry, 'roomDetailSubscribers' | 'sendToConnection' | 'broadcastAccountEvent'>;
  getRoomStore: () => RuntimeRoomStore;
  getUserStore?: (() => Pick<UserStore, 'getUserById'>) | null;
  publicChatMessage: (message: RoomChatMessage) => RoomMessage;
  scheduleSummary: (roomId: string) => void;
  now: () => number;
  logger: RuntimeLogger;
}

export function createRoomFanout(deps: RoomFanoutDeps) {
  const { presenceRooms, wsRegistry, getRoomStore, getUserStore, publicChatMessage, now, logger } = deps;

  function connectionWantsRoomDetail(connection: WsConnection, roomId: string): boolean {
    return connection.previewRoomIds.has(roomId) || connection.activeVoice?.roomId === roomId;
  }

  function broadcastRoomDetail(
    roomId: string,
    envelope: ServerEnvelope,
    { previewOnly = false, except = null }: { previewOnly?: boolean; except?: WsConnection | null } = {}
  ): void {
    for (const connection of wsRegistry.roomDetailSubscribers(roomId)) {
      if (connection === except) continue;
      const isActivePeer = connection.activeVoice?.roomId === roomId;
      if (previewOnly) {
        // Active peers already receive this over their voice transport via
        // broadcast(); only reach preview-only subscribers here.
        if (isActivePeer || !connection.previewRoomIds.has(roomId)) continue;
      } else if (!connectionWantsRoomDetail(connection, roomId)) {
        continue;
      }
      wsRegistry.sendToConnection(connection, envelope);
    }
  }

  function mirrorLegacyRoomEvent(roomId: string, message: RoomPeerMessage): void {
    const envelope = legacyPeerMessageToWs(message, roomId);
    broadcastRoomDetail(roomId, envelope, { previewOnly: true });
  }

  function broadcastChatMessage(roomId: string, message: RoomChatMessage): void {
    const envelope = buildServerEnvelope('room.chat.message', {
      roomId,
      message: publicChatMessage(message)
    });
    broadcastRoomDetail(roomId, envelope);
    deps.scheduleSummary(roomId);
    void broadcastRoomMessageNotification(roomId, message);
  }

  // Typing notices are forwarded and never stored. Only someone who can read
  // the room chat may announce typing in it: an account with the room open or
  // in its call, or a guest in its call. The name comes from the call roster or
  // the account profile, never from the client.
  const TYPING_PROFILE_TTL_MS = 60_000;

  async function typistForConnection(
    connection: WsConnection,
    roomId: string
  ): Promise<{ peerId: string; userId: string | null; name: string } | null> {
    const voicePeerId = connection.activeVoice?.roomId === roomId ? connection.activeVoice.peerId : '';
    const peer = voicePeerId ? presenceRooms.get(roomId)?.peers.get(voicePeerId) : null;
    if (peer) {
      return { peerId: peer.id, userId: peer.accountUserId || null, name: cleanName(peer.name) || 'Гость' };
    }
    if (!connection.userId || !connection.previewRoomIds.has(roomId) || !getUserStore) return null;
    const cached = connection.typingProfile;
    if (cached && now() - cached.at < TYPING_PROFILE_TTL_MS) return cached.typist;
    const user = await getUserStore().getUserById(connection.userId);
    if (!user) return null;
    const typist = { peerId: `auth-${user.id}`, userId: user.id, name: user.displayName || user.login || '' };
    connection.typingProfile = { at: now(), typist };
    return typist;
  }

  function broadcastRoomTyping(connection: WsConnection, roomId: string, activity: TypingActivity = 'typing'): void {
    if (connection.closed || !roomId) return;
    connection.roomTypingThrottle ??= createTypingThrottle<TypingActivity>({ now });
    connection.roomTypingThrottle.offer(roomId, activity, (value: TypingActivity) => {
      sendRoomTyping(connection, roomId, value).catch((error: unknown) => {
        logger.warn(
          { evt: LOG_EVENTS.ROOM_TYPING_FORWARD_FAILED, roomId, err: error },
          'failed to forward a room typing notice'
        );
      });
    });
  }

  async function sendRoomTyping(connection: WsConnection, roomId: string, activity: TypingActivity): Promise<void> {
    const typist = await typistForConnection(connection, roomId);
    if (!typist || connection.closed) return;
    broadcastRoomDetail(roomId, buildServerEnvelope('room.chat.typing', { roomId, typist, activity }), {
      except: connection
    });
  }

  function roomNotificationContext(room: { avatarKey?: string | null; id: string; name?: string }) {
    return {
      avatarUrl: room.avatarKey ? `/api/avatars/${encodeURIComponent(room.avatarKey)}` : null,
      roomId: room.id,
      name: room.name || ''
    };
  }

  function senderNotificationContext(message: RoomChatMessage, user: StoredUser | null) {
    if (user) {
      return {
        id: user.id,
        displayName: user.displayName || '',
        login: user.login || '',
        avatarAccent: user.avatarAccent || null,
        avatarColorKey: user.avatarColorKey || message.avatarColorKey || '',
        avatarUrl: user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null
      };
    }
    return {
      id: message.authorUserId || '',
      peerId: message.peerId || '',
      displayName: message.name || '',
      login: '',
      avatarAccent: message.avatarAccent || null,
      avatarColorKey: message.avatarColorKey || '',
      avatarUrl: message.avatarUrl || null
    };
  }

  async function broadcastRoomMessageNotification(roomId: string, message: RoomChatMessage): Promise<void> {
    if (!getUserStore) return;
    const userStore = getUserStore;
    let room: Awaited<ReturnType<RuntimeRoomStore['getRoom']>>;
    try {
      room = await getRoomStore().getRoom(roomId);
    } catch (error) {
      logger.error(
        { evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'room', err: error },
        'failed to resolve the room for a room notification'
      );
      return;
    }
    if (!room?.isStatic) return;

    let recipients: string[];
    try {
      const listNotificationRecipients = getRoomStore().listNotificationRecipientUserIds;
      recipients = typeof listNotificationRecipients === 'function' ? await listNotificationRecipients(roomId) : [];
    } catch (error) {
      logger.error(
        { evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'recipients', err: error },
        'failed to resolve room notification recipients'
      );
      return;
    }

    const authorUserId = message.authorUserId || '';
    let authorUser: StoredUser | null = null;
    if (authorUserId) {
      try {
        authorUser = await userStore().getUserById(authorUserId);
      } catch (error) {
        logger.warn(
          { evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'sender', err: error },
          'failed to resolve a room notification sender'
        );
      }
    }

    const notification: AccountMessage = {
      type: 'notification.room.message',
      dedupeKey: `room:${roomId}:message:${message.id}`,
      room: roomNotificationContext(room),
      sender: senderNotificationContext(message, authorUser),
      message: {
        id: message.id,
        body: message.text,
        createdAt: message.createdAt
      }
    };

    for (const userId of recipients) {
      if (!userId || (authorUserId && userId === authorUserId)) continue;
      try {
        wsRegistry.broadcastAccountEvent(userId, notification);
      } catch (error) {
        logger.error(
          { evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'broadcast', err: error },
          'failed to broadcast a room notification'
        );
      }
    }
  }

  return { broadcastRoomDetail, mirrorLegacyRoomEvent, broadcastChatMessage, broadcastRoomTyping };
}
