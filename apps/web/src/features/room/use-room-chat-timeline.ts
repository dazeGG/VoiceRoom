// The messages a room chat shows. An account reads paged history anchored at
// the newest message (or at a linked one); a guest reads the room's recent
// window, since paged history is account-only. Both keep the same list, so the
// chat view adds, edits and removes messages without knowing which it has.

import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';
import { t } from '@/shared/i18n';
import { ref } from 'vue';
import { plainSnapshot } from '@/shared/utils/plain-snapshot';
import { ApiError } from '@/api/client';
import { fetchRoomChat, fetchRoomChatPage, type ChatMessage } from '@/api/rooms';
import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import { createHistoryCache } from '@/shared/chat/history-cache';
import { createAnchoredHistory } from '@/shared/chat/anchored-history';
import { createHistorySnapshots } from '@/shared/chat/history-snapshots';
import { mergeLatestWindow, restampAuthor } from './room-chat-view';

const MAX_EARLY_EDITS = 50;

/** Room chats kept between visits, by room id. */
const roomHistoryCache = createHistoryCache<ChatMessage>((messages) =>
  messages.map((message) => plainSnapshot(message))
);

export function useRoomChatTimeline() {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(true);
  const loadingOlder = ref(false);
  const hasMoreBefore = ref(false);
  const error = useLocalizedText();
  /** Paged history (an account) rather than the recent window (a guest). */
  const paged = ref(false);

  // Paged history is for rooms the account keeps. A room just entered is not
  // kept yet, and a temporary one never is; the API then answers room_forbidden.
  let refused = false;
  let recentRequest = 0;
  let recentScope = '';
  const recentSnapshots = createHistorySnapshots<ChatMessage>();

  const history = createAnchoredHistory<ChatMessage>({
    loadPage: async (roomId, request) => {
      try {
        return await fetchRoomChatPage(roomId, request);
      } catch (cause) {
        if (!request.signal.aborted && cause instanceof ApiError && cause.code === 'room_forbidden') refused = true;
        throw cause;
      }
    },
    compare: (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    cache: roomHistoryCache,
    onChange: (state) => {
      messages.value = state.messages;
      forgetShownEdits();
      loading.value = state.loading;
      loadingOlder.value = state.loadingOlder;
      hasMoreBefore.value = state.hasMoreBefore;
      error.value = () => state.error;
    }
  });

  // A realtime copy of a message this client just sent can arrive before the
  // POST answers, so both paths ask before adding.
  function has(messageId: string): boolean {
    return messages.value.some((message) => message.id === messageId);
  }

  /**
   * Opens paged history around `anchorMessageId`, or at the newest message. An
   * account that is refused it reads the recent window instead, as a guest in
   * the same room does.
   */
  async function open(roomId: string, anchorMessageId?: string): Promise<void> {
    const request = ++recentRequest;
    recentScope = '';
    recentSnapshots.reset();
    earlyEdits = {};
    paged.value = true;
    refused = false;
    await history.open(roomId, anchorMessageId);
    if (request === recentRequest && refused) await loadRecent(roomId);
  }

  /** Loads the recent window (the guest path); answers false when aborted. */
  async function loadRecent(roomId: string, signal?: AbortSignal): Promise<boolean> {
    const request = ++recentRequest;
    history.close();
    if (recentScope !== roomId) {
      recentSnapshots.reset();
      earlyEdits = {};
      recentScope = roomId;
    }
    const snapshot = recentSnapshots.begin('recent');
    paged.value = false;
    try {
      const recent = await fetchRoomChat(roomId);
      if (signal?.aborted || request !== recentRequest) return false;
      const current = snapshot.apply(recent);
      if (!current) return false;
      error.value = '';
      messages.value = current;
      forgetShownEdits();
      return true;
    } catch (cause) {
      if (signal?.aborted || request !== recentRequest) return false;
      error.value = () => (cause instanceof Error ? currentErrorMessage(cause) : t('Не удалось загрузить чат'));
      return false;
    } finally {
      snapshot.dispose();
      if (!signal?.aborted && request === recentRequest) loading.value = false;
    }
  }

  function loadOlder(scrollElement: HTMLElement | null): Promise<void> {
    return paged.value ? history.loadOlder(scrollElement) : Promise.resolve();
  }

  // An edit can overtake its message: a link preview is published straight
  // away, while the message itself may still be on its way through the
  // delivery worker. The edit waits here and wins when the message arrives.
  // Not reactive: nothing renders it.
  let earlyEdits: Record<string, ChatMessage | null> = {};

  function forgetShownEdits(): void {
    earlyEdits = Object.fromEntries(Object.entries(earlyEdits).filter(([id]) => !has(id)));
  }

  /** Adds a new message; answers false when it is already there. */
  function add(message: ChatMessage): boolean {
    if (!message.id || has(message.id)) return false;
    const { [message.id]: early, ...stillEarly } = earlyEdits;
    earlyEdits = stillEarly;
    const current = early ?? message;
    if (paged.value) history.upsert(current);
    else {
      recentSnapshots.upsert(current);
      messages.value = [...messages.value, current];
    }
    return true;
  }

  /** Replaces a message the list has (an edit); one not there yet waits for it. */
  function replace(message: ChatMessage): void {
    if (paged.value) history.edit(message);
    else recentSnapshots.edit(message);
    if (!has(message.id)) {
      if (earlyEdits[message.id] === null) return;
      const waiting = Object.entries({ ...earlyEdits, [message.id]: message });
      // The oldest edit gives way once too many wait.
      earlyEdits = Object.fromEntries(waiting.slice(-MAX_EARLY_EDITS));
      return;
    }
    if (!paged.value) messages.value = messages.value.map((item) => (item.id === message.id ? message : item));
  }

  function remove(messageId: string): void {
    earlyEdits = Object.fromEntries(Object.entries({ ...earlyEdits, [messageId]: null }).slice(-MAX_EARLY_EDITS));
    if (paged.value) history.remove(messageId);
    else {
      recentSnapshots.remove(messageId);
      messages.value = messages.value.filter((message) => message.id !== messageId);
    }
  }

  /** Account-backed messages show the current profile of a refreshed peer. */
  function restamp(peer: PublicPeer): void {
    const restamped = restampAuthor(messages.value, peer);
    if (restamped) messages.value = restamped;
  }

  /**
   * Reconciles the server's latest messages with what is shown: known ids are
   * replaced, so edits missed while disconnected appear, and in the recent
   * window messages appended locally outside it stay.
   */
  function reconcileLatest(latest: ChatMessage[], snapshot?: ReturnType<typeof history.beginSnapshot>): boolean {
    const current = snapshot ? snapshot.apply(latest) : latest;
    if (!current) return false;
    if (paged.value) {
      const firstCreatedAt = latest[0]?.createdAt;
      history.reconcileLatest(current, (item) => firstCreatedAt == null || item.createdAt >= firstCreatedAt, snapshot);
      return true;
    }
    error.value = '';
    for (const message of current) (snapshot ?? recentSnapshots).upsert(message);
    messages.value = mergeLatestWindow(messages.value, current);
    forgetShownEdits();
    return true;
  }

  /** The newest read cursor among the shown messages. */
  function latestReadCursor(): string | undefined {
    for (let index = messages.value.length - 1; index >= 0; index -= 1) {
      const cursor = messages.value[index]?.readCursor;
      if (cursor) return cursor;
    }
    return undefined;
  }

  function close(): void {
    recentRequest++;
    recentScope = '';
    recentSnapshots.reset();
    earlyEdits = {};
    history.close();
  }

  return {
    messages,
    loading,
    loadingOlder,
    hasMoreBefore,
    error,
    setError: (source: () => string): void => {
      error.value = source;
    },
    paged,
    has,
    open,
    loadRecent,
    loadOlder,
    add,
    replace,
    remove,
    restamp,
    reconcileLatest,
    beginSnapshot: () => (paged.value ? history.beginSnapshot('cursor') : recentSnapshots.begin('cursor')),
    latestReadCursor,
    close
  };
}

export type RoomChatTimeline = ReturnType<typeof useRoomChatTimeline>;
