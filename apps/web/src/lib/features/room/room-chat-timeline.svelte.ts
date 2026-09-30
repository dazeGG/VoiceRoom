// The messages a room chat shows. An account reads paged history anchored at
// the newest message (or at a linked one); a guest reads the room's recent
// window, since paged history is account-only. Both keep the same list, so the
// chat view adds, edits and removes messages without knowing which it has.

import { ApiError } from '$lib/api/client';
import { fetchRoomChat, fetchRoomChatPage, type ChatMessage } from '$lib/api/rooms';
import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import { createAnchoredHistory } from './room-history.svelte';
import { mergeLatestWindow, restampAuthor } from './room-chat-view';

const MAX_EARLY_EDITS = 50;

export class RoomChatTimeline {
  messages = $state<ChatMessage[]>([]);
  loading = $state(true);
  loadingOlder = $state(false);
  hasMoreBefore = $state(false);
  error = $state('');
  /** Paged history (an account) rather than the recent window (a guest). */
  paged = $state(false);

  // Paged history is for rooms the account keeps. A room just entered is not
  // kept yet, and a temporary one never is; the API then answers room_forbidden.
  #refused = false;

  #history = createAnchoredHistory<ChatMessage>({
    loadPage: async (roomId, request) => {
      try {
        return await fetchRoomChatPage(roomId, request);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'room_forbidden') this.#refused = true;
        throw error;
      }
    },
    compare: (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    onChange: (state) => {
      this.messages = state.messages;
      this.loading = state.loading;
      this.loadingOlder = state.loadingOlder;
      this.hasMoreBefore = state.hasMoreBefore;
      this.error = state.error;
    }
  });

  // A realtime copy of a message this client just sent can arrive before the
  // POST answers, so both paths ask before adding.
  has(messageId: string): boolean {
    return this.messages.some((message) => message.id === messageId);
  }

  /**
   * Opens paged history around `anchorMessageId`, or at the newest message. An
   * account that is refused it reads the recent window instead, as a guest in
   * the same room does.
   */
  async open(roomId: string, anchorMessageId?: string): Promise<void> {
    this.paged = true;
    this.#refused = false;
    await this.#history.open(roomId, anchorMessageId);
    if (this.#refused) await this.loadRecent(roomId);
  }

  /** Loads the recent window (the guest path); answers false when aborted. */
  async loadRecent(roomId: string, signal?: AbortSignal): Promise<boolean> {
    this.paged = false;
    try {
      const messages = await fetchRoomChat(roomId);
      if (signal?.aborted) return false;
      this.error = '';
      this.messages = messages;
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      this.error = error instanceof Error ? error.message : 'Не удалось загрузить чат';
      return false;
    } finally {
      if (!signal?.aborted) this.loading = false;
    }
  }

  loadOlder(scrollElement: HTMLElement | null): Promise<void> {
    return this.paged ? this.#history.loadOlder(scrollElement) : Promise.resolve();
  }

  /** Adds a new message; answers false when it is already there. */
  add(message: ChatMessage): boolean {
    if (!message.id || this.has(message.id)) return false;
    const current = this.#earlyEdits[message.id] ?? message;
    delete this.#earlyEdits[message.id];
    if (this.paged) this.#history.upsert(current);
    else this.messages = [...this.messages, current];
    return true;
  }

  // An edit can overtake its message: a link preview is published straight
  // away, while the message itself may still be on its way through the
  // delivery worker. The edit waits here and wins when the message arrives.
  // Not reactive: nothing renders it.
  #earlyEdits: Record<string, ChatMessage> = {};

  /** Replaces a message the list has (an edit); one not there yet waits for it. */
  replace(message: ChatMessage): void {
    if (!this.has(message.id)) {
      this.#earlyEdits[message.id] = message;
      const waiting = Object.keys(this.#earlyEdits);
      if (waiting.length > MAX_EARLY_EDITS) delete this.#earlyEdits[waiting[0]];
      return;
    }
    if (this.paged) this.#history.upsert(message);
    else this.messages = this.messages.map((item) => (item.id === message.id ? message : item));
  }

  remove(messageId: string): void {
    if (this.paged) this.#history.remove(messageId);
    else this.messages = this.messages.filter((message) => message.id !== messageId);
  }

  /** Account-backed messages show the current profile of a refreshed peer. */
  restamp(peer: PublicPeer): void {
    const restamped = restampAuthor(this.messages, peer);
    if (restamped) this.messages = restamped;
  }

  /**
   * Reconciles the server's latest messages with what is shown: known ids are
   * replaced, so edits missed while disconnected appear, and in the recent
   * window messages appended locally outside it stay.
   */
  reconcileLatest(latest: ChatMessage[]): void {
    if (this.paged) {
      const firstCreatedAt = latest[0]?.createdAt;
      this.#history.reconcileLatest(latest, (item) => firstCreatedAt == null || item.createdAt >= firstCreatedAt);
      return;
    }
    this.error = '';
    this.messages = mergeLatestWindow(this.messages, latest);
  }

  /** The newest read cursor among the shown messages. */
  latestReadCursor(): string | undefined {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      if (this.messages[index].readCursor) return this.messages[index].readCursor;
    }
    return undefined;
  }

  close(): void {
    this.#history.close();
  }
}
