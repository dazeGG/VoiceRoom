// The controller of one room chat: its messages, the realtime events that
// change them, what is read, and what is on its way out. RoomChatPanel renders
// it; the in-room rail and the lobby preview both mount that panel, so the host
// hands in who the viewer is and how the room reacts to lifecycle events.

import { computed, markRaw, nextTick, reactive } from 'vue';
import {
  chatMessageFromRoomMessage,
  deleteRoomChatMessage,
  editRoomChatMessage,
  fetchRoomChatPage,
  markRoomChatRead,
  postRoomChat,
  type ChatMessage
} from '@/api/rooms';
import { useRoomPresenceStore } from '@/entities/room/room-presence.store';
import { subscribeRoomPreview } from '@/entities/room/room-realtime';
import { useSessionStore } from '@/features/auth/session.store';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { useChatScroll } from '@/shared/chat/use-chat-scroll';
import { Outbox } from '@/shared/chat/outbox';
import { createReactionStore } from '@/shared/chat/reaction-store';
import { createReadReconciliation } from '@/shared/chat/read-reconciliation';
import { createTypingTracker, formatTypingLabel, typingActivityOf } from '@/shared/chat/typing';
import { createLogger, errorContext } from '@/shared/log';
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import { playRoomChatMessageCue } from './client/media/cues';
import type { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from './client/room/lifecycle';
import { useRoomPinsStore } from './pins.store';
import { useRoomChatTimeline } from './use-room-chat-timeline';

const log = createLogger('room:chat');

/** What the composer hands the session to post. */
export interface OutgoingRoomMessage {
  text: string;
  content: RoomMessageContentV1 | undefined;
  attachmentIds: string[];
  replyTo: { messageId: string } | undefined;
}

/** What the surrounding page decides; each member is read when it is needed. */
export interface RoomChatHost {
  roomId: () => string;
  peerId: () => string;
  sessionToken: () => string;
  displayName: () => string;
  /** The chat is on screen (its tab is open and the panel is shown). */
  visible: () => boolean;
  /** The message to land on: the host's choice, or the link's `around` parameter. */
  aroundMessageId: () => string | undefined;
  onRead: () => void;
  onUnreadMessage: () => void;
  toast: (message: string, options?: { variant?: 'error' }) => void;
  lifecycle: {
    updated: typeof applyRoomUpdated;
    notFound: typeof applyRoomNotFound;
    deleted: typeof applyRoomDeleted;
  };
}

export function useRoomChatSession(host: RoomChatHost) {
  const sessionStore = useSessionStore();
  const roomPins = useRoomPinsStore();
  const timeline = reactive(useRoomChatTimeline());
  const scroll = useChatScroll();
  const reactions = createReactionStore();
  const typing = createTypingTracker();
  const typingLabel = computed(() => formatTypingLabel(typing.people));
  let readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;

  // Messages on their way: shown at the foot of the chat until the server has
  // them, then they join it like any other. A class instance with private
  // fields, so it stays out of Vue's proxies.
  const outbox = markRaw(
    new Outbox<OutgoingRoomMessage, ChatMessage>({
      // Resolved per send: the room rail reads a guest name that the name dialog
      // can persist after the panel mounted.
      deliver: (outgoing, idempotencyKey) =>
        postRoomChat(host.roomId(), {
          name: host.displayName(),
          ...peerCredentials(),
          ...outgoing,
          idempotencyKey
        }),
      onSent: (message) => {
        if (timeline.add(message) && host.visible()) host.onRead();
      }
    })
  );

  const isOwnMessage = (message: ChatMessage): boolean => {
    const accountUserId = sessionStore.user?.id;
    const peerId = host.peerId();
    return Boolean((accountUserId && message.authorUserId === accountUserId) || (peerId && message.peerId === peerId));
  };

  /** Loads the history and follows the room's events; returns what ends both. */
  function start(): () => void {
    const roomId = host.roomId();
    if (!roomId) {
      timeline.loading = false;
      timeline.error = 'Комната не найдена';
      return () => {};
    }

    reactions.setConversation({ type: 'room', id: roomId });

    const controller = new AbortController();
    void initializeHistory(controller.signal);
    // Server-side preview subscription: without it the API only routes room
    // events (chat included) to active voice peers, so a user who opened the
    // room page but had not joined voice never received realtime messages.
    // It also re-subscribes after a WS reconnect and backfills missed
    // messages from the fresh room.snapshot.
    const unsubscribe = subscribeRoomPreview(roomId, (event) => {
      const { lifecycle } = host;
      switch (event.type) {
        case 'room.not_found':
          lifecycle.notFound(event.payload.roomId);
          timeline.error = 'Комната не найдена';
          return;
        case 'room.updated':
          lifecycle.updated(event.payload.room);
          return;
        case 'room.deleted':
          lifecycle.deleted(event.payload.roomId);
          return;
        case 'room.snapshot':
          if (Array.isArray(event.payload.recentMessages)) {
            mergeMessages(event.payload.recentMessages.map(chatMessageFromRoomMessage));
            timeline.loading = false;
          }
          return;
        case 'room.chat.deleted': {
          const messageId = event.payload?.messageId;
          if (messageId) {
            timeline.remove(messageId);
            reactions.markDeleted(messageId);
          }
          return;
        }
        case 'reaction.updated':
          reactions.applyServer(event.payload.messageId, event.payload.summary);
          return;
        case 'room.pins':
          roomPins.applyRoomPinsEvent(event.payload.roomId, event.payload);
          return;
        case 'room.chat.edited': {
          const edited = chatMessageFromRoomMessage(event.payload.message);
          if (edited?.id) timeline.replace(edited);
          return;
        }
        // Account-backed messages render the current profile. Keep the open rail
        // in sync immediately when the room broadcasts a refreshed peer.
        case 'room.peer.updated': {
          const peer = event.payload.peer;
          if (peer?.id) timeline.restamp(peer);
          return;
        }
        case 'room.chat.typing': {
          const typist = event.payload.typist;
          if (
            !typist ||
            typist.peerId === host.peerId() ||
            (typist.userId && typist.userId === sessionStore.user?.id)
          ) {
            return;
          }
          typing.note(typingKey(typist), typist.name, typingActivityOf(event.payload.activity));
          return;
        }
        case 'room.chat.message':
          receive(chatMessageFromRoomMessage(event.payload.message));
          return;
        default:
          return;
      }
    });

    return () => {
      controller.abort();
      timeline.close();
      readReconciliation?.dispose();
      roomPins.resetRoomPins();
      unsubscribe();
    };
  }

  /** The chat came on screen: it counts as read and parks on the newest message. */
  function show(): () => void {
    host.onRead();
    const endReadSession = useRoomPresenceStore().beginRoomChatReadSession(host.roomId());
    void scroll.settle().then(() => markLatestRenderedRead());
    return endReadSession;
  }

  function send(outgoing: OutgoingRoomMessage): void {
    outbox.enqueue(outgoing);
    if (host.visible()) void scroll.settle();
  }

  const loadOlder = (element: HTMLElement | null): void => {
    if (timeline.paged) void timeline.loadOlder(element);
  };

  const jumpTo = (messageId: string): void => {
    scroll.jumpTo(messageId, () => host.toast('Сообщение не загружено — прокрутите историю выше'));
  };

  async function togglePinned(messageId: string): Promise<void> {
    try {
      await roomPins.togglePin(host.roomId(), messageId);
    } catch (err) {
      host.toast(err instanceof Error && err.message ? err.message : 'Не удалось закрепить сообщение', {
        variant: 'error'
      });
    }
  }

  async function deleteMessage(messageId: string): Promise<void> {
    const roomId = host.roomId();
    if (!roomId) return;
    try {
      await deleteRoomChatMessage(roomId, messageId, peerCredentials());
      timeline.remove(messageId);
    } catch {
      timeline.error = 'Не удалось удалить сообщение';
      setTimeout(() => (timeline.error = ''), 1600);
    }
  }

  async function saveEdit(messageId: string, text: string): Promise<void> {
    timeline.error = '';
    try {
      timeline.replace(await editRoomChatMessage(host.roomId(), messageId, { ...peerCredentials(), text }));
    } catch (err) {
      timeline.error = err instanceof Error ? err.message : 'Не удалось изменить сообщение';
      throw err;
    }
  }

  /** The own message ArrowUp edits: the newest one. */
  function lastOwnMessage(): ChatMessage | undefined {
    return timeline.messages.findLast(isOwnMessage);
  }

  // Peer credentials exist only for a viewer who joined the room; the lobby
  // preview posts as the signed-in account instead.
  function peerCredentials(): { peerId?: string; sessionToken?: string } {
    const sessionToken = host.sessionToken();
    return sessionToken ? { peerId: host.peerId(), sessionToken } : {};
  }

  function receive(message: ChatMessage | null | undefined): void {
    if (message) typing.clear(typingKey(message));
    if (!message || !timeline.add(message)) return;
    const roomId = host.roomId();
    timeline.error = '';
    if (message.peerId !== host.peerId() && !useNotificationPreferencesStore().isRoomNotificationsMuted(roomId)) {
      playRoomChatMessageCue(message.id);
    }
    if (!host.visible()) {
      host.onUnreadMessage();
      return;
    }
    host.onRead();
    useRoomPresenceStore().setRoomUnreadCount(roomId, 0);
    void nextTick().then(() => {
      if (scroll.pinned) scroll.toBottom();
      void markRealtimeRenderedRead(message);
    });
  }

  // The server's recent messages after a (re)subscribe: edits missed while
  // disconnected appear, and the view stays on the newest message.
  function mergeMessages(recent: ChatMessage[]): void {
    timeline.reconcileLatest(recent);
    if (timeline.paged) {
      if (host.visible()) void nextTick().then(() => markLatestRenderedRead());
      return;
    }
    if (host.visible()) {
      host.onRead();
      void scroll.settle();
    }
  }

  async function initializeHistory(signal: AbortSignal): Promise<void> {
    const roomId = host.roomId();
    // Paged history is account-only: GET /chat/history answers a guest with 401
    // «Room is not available», which surfaced as a chat error in a room a guest
    // can otherwise read and write. Guests keep the recent-window endpoint.
    const paged = Boolean(sessionStore.user?.id);
    readReconciliation?.dispose();
    readReconciliation = paged
      ? createReadReconciliation({
          scope: `room:${roomId}`,
          commit: (cursor) => markRoomChatRead(roomId, cursor)
        })
      : null;
    const anchorMessageId = host.aroundMessageId();
    if (paged) {
      const opening = timeline.open(roomId, anchorMessageId);
      // A room visited before shows its kept messages at once: park on the newest.
      if (!anchorMessageId && host.visible() && timeline.messages.length > 0) void scroll.settle();
      await opening;
    } else await refreshMessages(signal);
    // Pins, like paged history, are for a room the account keeps: a guest and
    // an account that was just refused that history would only be refused again.
    if (timeline.paged && !signal.aborted) void roomPins.loadRoomPins(roomId);
    if (anchorMessageId && !signal.aborted) {
      await nextTick();
      scroll.pinned = false;
      // Arriving from a notification lands the way jumping to a reply does:
      // centred and flashed. Mentions are already tinted, so with several on
      // screen the flash is what says which one this link was for.
      const target = scroll.row(anchorMessageId);
      if (target) scroll.flash(target);
    } else if (!signal.aborted && host.visible()) {
      // The first page must land on the newest message: the body was empty when
      // the visibility effect ran, so its scroll then was a no-op.
      await scroll.settle();
    }
    if (!signal.aborted && host.visible()) await nextTick().then(() => markLatestRenderedRead());
  }

  async function refreshMessages(signal: AbortSignal): Promise<void> {
    const roomId = host.roomId();
    if (!roomId) return;
    if ((await timeline.loadRecent(roomId, signal)) && host.visible()) {
      host.onRead();
      void scroll.settle();
    }
  }

  async function markLatestRenderedRead(cursor = timeline.latestReadCursor()): Promise<void> {
    if (!host.visible() || !sessionStore.user?.id || !host.roomId() || !readReconciliation) return;
    await readReconciliation.advanceAfterRender(cursor);
  }

  async function markRealtimeRenderedRead(message: ChatMessage): Promise<void> {
    // Read cursors and paged history are account-only; a guest has neither.
    if (!timeline.paged || !readReconciliation) return;
    if (message.readCursor) {
      await markLatestRenderedRead(message.readCursor);
      return;
    }
    try {
      const roomId = host.roomId();
      const page = await fetchRoomChatPage(roomId, { mode: 'latest' });
      if (!timeline.paged || host.roomId() !== roomId || !page.messages.some((item) => item.id === message.id)) {
        return;
      }
      timeline.reconcileLatest(page.messages);
      await nextTick();
      await markLatestRenderedRead();
    } catch (cause) {
      log.error('failed to reconcile realtime room read cursor', errorContext(cause));
    }
  }

  return {
    timeline,
    scroll,
    reactions,
    typing,
    typingLabel,
    outbox,
    isOwnMessage,
    start,
    show,
    send,
    loadOlder,
    jumpTo,
    togglePinned,
    deleteMessage,
    saveEdit,
    lastOwnMessage
  };
}

export type RoomChatSession = ReturnType<typeof useRoomChatSession>;

// Who else is typing in this room. Notices name the person the server saw,
// keyed like message authors (account id, or the guest's peer id) so their
// message clears them.
function typingKey(person: { userId?: string | null; authorUserId?: string | null; peerId?: string }): string {
  return person.userId || person.authorUserId || person.peerId || '';
}
