// The controller of one room chat: its messages, the realtime events that
// change them, what is read, and what is on its way out. RoomChatPanel renders
// it; the in-room rail and the lobby preview both mount that panel, so the host
// hands in who the viewer is and how the room reacts to lifecycle events.

import { tick } from 'svelte';
import {
  chatMessageFromRoomMessage,
  deleteRoomChatMessage,
  editRoomChatMessage,
  fetchRoomChatPage,
  markRoomChatRead,
  postRoomChat,
  type ChatMessage
} from '$lib/api/rooms';
import { beginRoomChatReadSession, setRoomUnreadCount } from '$lib/entities/room/room-presence.svelte';
import { subscribeRoomPreview } from '$lib/entities/room/room-realtime';
import { session } from '$lib/features/auth/session.svelte';
import { isRoomNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
import { ChatScroll } from '$lib/shared/chat/chat-scroll.svelte';
import { Outbox } from '$lib/shared/chat/outbox.svelte';
import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
import { createReadReconciliation } from '$lib/shared/chat/read-reconciliation';
import { createTypingTracker, formatTypingLabel, typingActivityOf } from '$lib/shared/chat/typing.svelte';
import { createLogger, errorContext } from '$lib/shared/log';
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import { playRoomChatMessageCue } from './client/media/cues';
import type { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from './client/room/lifecycle';
import { applyRoomPinsEvent, loadRoomPins, resetRoomPins, togglePin } from './pins.svelte';
import { RoomChatTimeline } from './room-chat-timeline.svelte';

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

export class RoomChatSession {
  readonly timeline = new RoomChatTimeline();
  readonly scroll = new ChatScroll();
  readonly reactions = createReactionStore();
  readonly typing = createTypingTracker();
  readonly typingLabel = $derived(formatTypingLabel(this.typing.people));
  // Messages on their way: shown at the foot of the chat until the server has
  // them, then they join it like any other.
  readonly outbox = new Outbox<OutgoingRoomMessage, ChatMessage>({
    // Resolved per send: the room rail reads a guest name that the name dialog
    // can persist after the panel mounted.
    deliver: (outgoing, idempotencyKey) =>
      postRoomChat(this.#host.roomId(), {
        name: this.#host.displayName(),
        ...this.#peerCredentials(),
        ...outgoing,
        idempotencyKey
      }),
    onSent: (message) => {
      if (this.timeline.add(message) && this.#host.visible()) this.#host.onRead();
    }
  });

  readonly #host: RoomChatHost;
  #readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;

  constructor(host: RoomChatHost) {
    this.#host = host;
  }

  isOwnMessage = (message: ChatMessage): boolean => {
    const accountUserId = session.user?.id;
    const peerId = this.#host.peerId();
    return Boolean((accountUserId && message.authorUserId === accountUserId) || (peerId && message.peerId === peerId));
  };

  /** Loads the history and follows the room's events; returns what ends both. */
  start(): () => void {
    const roomId = this.#host.roomId();
    if (!roomId) {
      this.timeline.loading = false;
      this.timeline.error = 'Комната не найдена';
      return () => {};
    }

    this.reactions.setConversation({ type: 'room', id: roomId });

    const controller = new AbortController();
    void this.#initializeHistory(controller.signal);
    // Server-side preview subscription: without it the API only routes room
    // events (chat included) to active voice peers, so a user who opened the
    // room page but had not joined voice never received realtime messages.
    // It also re-subscribes after a WS reconnect and backfills missed
    // messages from the fresh room.snapshot.
    const unsubscribe = subscribeRoomPreview(roomId, (event) => {
      const { lifecycle } = this.#host;
      switch (event.type) {
        case 'room.not_found':
          lifecycle.notFound(event.payload.roomId);
          this.timeline.error = 'Комната не найдена';
          return;
        case 'room.updated':
          lifecycle.updated(event.payload.room);
          return;
        case 'room.deleted':
          lifecycle.deleted(event.payload.roomId);
          return;
        case 'room.snapshot':
          if (Array.isArray(event.payload.recentMessages)) {
            this.#mergeMessages(event.payload.recentMessages.map(chatMessageFromRoomMessage));
            this.timeline.loading = false;
          }
          return;
        case 'room.chat.deleted': {
          const messageId = event.payload?.messageId;
          if (messageId) {
            this.timeline.remove(messageId);
            this.reactions.markDeleted(messageId);
          }
          return;
        }
        case 'reaction.updated':
          this.reactions.applyServer(event.payload.messageId, event.payload.summary);
          return;
        case 'room.pins':
          applyRoomPinsEvent(event.payload.roomId, event.payload);
          return;
        case 'room.chat.edited': {
          const edited = chatMessageFromRoomMessage(event.payload.message);
          if (edited?.id) this.timeline.replace(edited);
          return;
        }
        // Account-backed messages render the current profile. Keep the open rail
        // in sync immediately when the room broadcasts a refreshed peer.
        case 'room.peer.updated': {
          const peer = event.payload.peer;
          if (peer?.id) this.timeline.restamp(peer);
          return;
        }
        case 'room.chat.typing': {
          const typist = event.payload.typist;
          if (
            !typist ||
            typist.peerId === this.#host.peerId() ||
            (typist.userId && typist.userId === session.user?.id)
          ) {
            return;
          }
          this.typing.note(typingKey(typist), typist.name, typingActivityOf(event.payload.activity));
          return;
        }
        case 'room.chat.message':
          this.#receive(chatMessageFromRoomMessage(event.payload.message));
          return;
        default:
          return;
      }
    });

    return () => {
      controller.abort();
      this.timeline.close();
      this.#readReconciliation?.dispose();
      resetRoomPins();
      unsubscribe();
    };
  }

  /** The chat came on screen: it counts as read and parks on the newest message. */
  show(): () => void {
    this.#host.onRead();
    const endReadSession = beginRoomChatReadSession(this.#host.roomId());
    void this.scroll.settle().then(() => this.#markLatestRenderedRead());
    return endReadSession;
  }

  send(outgoing: OutgoingRoomMessage): void {
    this.outbox.enqueue(outgoing);
    if (this.#host.visible()) void this.scroll.settle();
  }

  loadOlder = (element: HTMLElement | null): void => {
    if (this.timeline.paged) void this.timeline.loadOlder(element);
  };

  jumpTo = (messageId: string): void => {
    this.scroll.jumpTo(messageId, () => this.#host.toast('Сообщение не загружено — прокрутите историю выше'));
  };

  async togglePinned(messageId: string): Promise<void> {
    try {
      await togglePin(this.#host.roomId(), messageId);
    } catch (err) {
      this.#host.toast(err instanceof Error && err.message ? err.message : 'Не удалось закрепить сообщение', {
        variant: 'error'
      });
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    const roomId = this.#host.roomId();
    if (!roomId) return;
    try {
      await deleteRoomChatMessage(roomId, messageId, this.#peerCredentials());
      this.timeline.remove(messageId);
    } catch {
      this.timeline.error = 'Не удалось удалить сообщение';
      setTimeout(() => (this.timeline.error = ''), 1600);
    }
  }

  async saveEdit(messageId: string, text: string): Promise<void> {
    this.timeline.error = '';
    try {
      this.timeline.replace(
        await editRoomChatMessage(this.#host.roomId(), messageId, { ...this.#peerCredentials(), text })
      );
    } catch (err) {
      this.timeline.error = err instanceof Error ? err.message : 'Не удалось изменить сообщение';
      throw err;
    }
  }

  /** The own message ArrowUp edits: the newest one. */
  lastOwnMessage(): ChatMessage | undefined {
    return this.timeline.messages.findLast(this.isOwnMessage);
  }

  // Peer credentials exist only for a viewer who joined the room; the lobby
  // preview posts as the signed-in account instead.
  #peerCredentials(): { peerId?: string; sessionToken?: string } {
    const sessionToken = this.#host.sessionToken();
    return sessionToken ? { peerId: this.#host.peerId(), sessionToken } : {};
  }

  #receive(message: ChatMessage | null | undefined): void {
    if (message) this.typing.clear(typingKey(message));
    if (!message || !this.timeline.add(message)) return;
    const roomId = this.#host.roomId();
    this.timeline.error = '';
    if (message.peerId !== this.#host.peerId() && !isRoomNotificationsMuted(roomId)) {
      playRoomChatMessageCue(message.id);
    }
    if (!this.#host.visible()) {
      this.#host.onUnreadMessage();
      return;
    }
    this.#host.onRead();
    setRoomUnreadCount(roomId, 0);
    void tick().then(() => {
      if (this.scroll.pinned) this.scroll.toBottom();
      void this.#markRealtimeRenderedRead(message);
    });
  }

  // The server's recent messages after a (re)subscribe: edits missed while
  // disconnected appear, and the view stays on the newest message.
  #mergeMessages(recent: ChatMessage[]): void {
    this.timeline.reconcileLatest(recent);
    if (this.timeline.paged) {
      if (this.#host.visible()) void tick().then(() => this.#markLatestRenderedRead());
      return;
    }
    if (this.#host.visible()) {
      this.#host.onRead();
      void this.scroll.settle();
    }
  }

  async #initializeHistory(signal: AbortSignal): Promise<void> {
    const roomId = this.#host.roomId();
    const { timeline, scroll } = this;
    // Paged history is account-only: GET /chat/history answers a guest with 401
    // «Room is not available», which surfaced as a chat error in a room a guest
    // can otherwise read and write. Guests keep the recent-window endpoint.
    const paged = Boolean(session.user?.id);
    this.#readReconciliation?.dispose();
    this.#readReconciliation = paged
      ? createReadReconciliation({
          scope: `room:${roomId}`,
          commit: (cursor) => markRoomChatRead(roomId, cursor)
        })
      : null;
    const anchorMessageId = this.#host.aroundMessageId();
    if (paged) {
      const opening = timeline.open(roomId, anchorMessageId);
      // A room visited before shows its kept messages at once: park on the newest.
      if (!anchorMessageId && this.#host.visible() && timeline.messages.length > 0) void scroll.settle();
      await opening;
    } else await this.#refreshMessages(signal);
    // Pins, like paged history, are for a room the account keeps: a guest and
    // an account that was just refused that history would only be refused again.
    if (timeline.paged && !signal.aborted) void loadRoomPins(roomId);
    if (anchorMessageId && !signal.aborted) {
      await tick();
      scroll.pinned = false;
      // Arriving from a notification lands the way jumping to a reply does:
      // centred and flashed. Mentions are already tinted, so with several on
      // screen the flash is what says which one this link was for.
      const target = scroll.row(anchorMessageId);
      if (target) scroll.flash(target);
    } else if (!signal.aborted && this.#host.visible()) {
      // The first page must land on the newest message: the body was empty when
      // the visibility effect ran, so its scroll then was a no-op.
      await scroll.settle();
    }
    if (!signal.aborted && this.#host.visible()) await tick().then(() => this.#markLatestRenderedRead());
  }

  async #refreshMessages(signal: AbortSignal): Promise<void> {
    const roomId = this.#host.roomId();
    if (!roomId) return;
    if ((await this.timeline.loadRecent(roomId, signal)) && this.#host.visible()) {
      this.#host.onRead();
      void this.scroll.settle();
    }
  }

  async #markLatestRenderedRead(cursor = this.timeline.latestReadCursor()): Promise<void> {
    if (!this.#host.visible() || !session.user?.id || !this.#host.roomId() || !this.#readReconciliation) return;
    await this.#readReconciliation.advanceAfterRender(cursor);
  }

  async #markRealtimeRenderedRead(message: ChatMessage): Promise<void> {
    // Read cursors and paged history are account-only; a guest has neither.
    if (!this.timeline.paged || !this.#readReconciliation) return;
    if (message.readCursor) {
      await this.#markLatestRenderedRead(message.readCursor);
      return;
    }
    try {
      const roomId = this.#host.roomId();
      const page = await fetchRoomChatPage(roomId, { mode: 'latest' });
      if (
        !this.timeline.paged ||
        this.#host.roomId() !== roomId ||
        !page.messages.some((item) => item.id === message.id)
      ) {
        return;
      }
      this.timeline.reconcileLatest(page.messages);
      await tick();
      await this.#markLatestRenderedRead();
    } catch (cause) {
      log.error('failed to reconcile realtime room read cursor', errorContext(cause));
    }
  }
}

// Who else is typing in this room. Notices name the person the server saw,
// keyed like message authors (account id, or the guest's peer id) so their
// message clears them.
function typingKey(person: { userId?: string | null; authorUserId?: string | null; peerId?: string }): string {
  return person.userId || person.authorUserId || person.peerId || '';
}
