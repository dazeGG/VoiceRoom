// The DM thread the lobby has open: its paged history anchored at the newest
// message, the read cursor to commit once that message rendered, and the
// resync that converges the newest page after missed events. The lobby decides
// which peer is open; the thread keeps that peer's messages right.

import { nextTick, ref, toRaw } from 'vue';
import { fetchThreadPage, markThreadRead, type DirectMessage } from '@/api/dm';
import type { PublicUser } from '@/api/friends';
import { createAnchoredHistory } from '@/shared/chat/anchored-history';
import { createHistoryCache } from '@/shared/chat/history-cache';
import { createReadReconciliation } from '@/shared/chat/read-reconciliation';

/** Conversations kept between visits, by peer id. */
const dmHistoryCache = createHistoryCache<DirectMessage>((messages) =>
  messages.map((message) => structuredClone(toRaw(message)))
);

/** `isOpen` answers whether the lobby still shows this peer's thread. */
export function useDmThread(isOpen: (peerId: string) => boolean) {
  const peer = ref<PublicUser | null>(null);
  const messages = ref<DirectMessage[]>([]);
  const loading = ref(false);
  const loadingOlder = ref(false);
  const hasMoreBefore = ref(false);
  const historyError = ref('');
  const profileOpen = ref(false);

  // Read receipts: what has been on screen is reported once it has rendered.
  // Only a mounted conversation has one; a hidden thread reports nothing.
  let readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;

  const history = createAnchoredHistory<DirectMessage>({
    loadPage: async (peerId, request) => fetchThreadPage(peerId, request),
    compare: (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    cache: dmHistoryCache,
    onChange: (state) => {
      messages.value = state.messages;
      loading.value = state.loading;
      loadingOlder.value = state.loadingOlder;
      hasMoreBefore.value = state.hasMoreBefore;
      historyError.value = state.error;
    }
  });

  /** Shows `peerId`'s thread, starting from the friend's known profile. */
  async function open(peerId: string, knownPeer: PublicUser | null): Promise<void> {
    if (knownPeer) peer.value = knownPeer;
    await history.open(peerId);
    if (isOpen(peerId)) noteLatestRendered();
  }

  /** Starts reporting what the conversation on screen shows; the returned function stops it. */
  function attachReader(peerId: string): () => void {
    const reconciliation = createReadReconciliation({
      scope: `dm:${peerId}`,
      commit: async (cursor) => {
        await markThreadRead(peerId, cursor);
      }
    });
    readReconciliation = reconciliation;
    if (!loading.value) noteLatestRendered();
    return () => {
      reconciliation.dispose();
      if (readReconciliation === reconciliation) readReconciliation = null;
    };
  }

  /** Converges the newest page with the server after events may have been missed. */
  async function resync(peerId: string): Promise<void> {
    const page = await fetchThreadPage(peerId, { mode: 'latest' });
    if (!isOpen(peerId)) return;
    const firstCreatedAt = page.messages[0]?.createdAt;
    history.reconcileLatest(page.messages, (message) => firstCreatedAt == null || message.createdAt >= firstCreatedAt);
    noteLatestRendered();
  }

  function loadOlder(scrollElement: HTMLElement | null): Promise<void> {
    return history.loadOlder(scrollElement);
  }

  /** Adds a message the open thread shows (sent here or arrived live). */
  function append(incoming: DirectMessage): void {
    // A link preview can arrive as an edit before the message itself is
    // delivered; the later, preview-less copy must not wipe it.
    const known = messages.value.find((existing) => existing.id === incoming.id);
    history.upsert(
      known?.linkPreview && !incoming.linkPreview ? { ...incoming, linkPreview: known.linkPreview } : incoming
    );
  }

  function replace(message: DirectMessage): void {
    history.upsert(message);
  }

  function remove(messageId: string): void {
    history.remove(messageId);
  }

  /** The peer read everything: our sent messages show as read. */
  function markSentRead(isOwnMessage: (message: DirectMessage) => boolean, at: number): void {
    messages.value = messages.value.map((message) =>
      isOwnMessage(message) && message.readAt == null ? { ...message, readAt: at } : message
    );
  }

  /** Reports the newest cursor once the DOM has rendered the messages. */
  function noteLatestRendered(cursor?: string): void {
    const candidate = cursor || messages.value.findLast((message) => message.readCursor)?.readCursor;
    if (!candidate) return;
    const reconciliation = readReconciliation;
    void nextTick().then(() => reconciliation?.advanceAfterRender(candidate));
  }

  /** A live message rendered; without its cursor, the thread resyncs to learn it. */
  async function noteRealtimeRendered(peerId: string, message: DirectMessage): Promise<void> {
    if (message.readCursor) {
      noteLatestRendered(message.readCursor);
      return;
    }
    if (!isOpen(peerId)) return;
    await resync(peerId).catch(() => {});
  }

  const toggleProfile = (): void => {
    profileOpen.value = !profileOpen.value;
  };

  const closeProfile = (): void => {
    profileOpen.value = false;
  };

  /** Stops loading the thread that was open (another one opens, or the lobby closes). */
  function close(): void {
    readReconciliation?.dispose();
    readReconciliation = null;
    history.close();
  }

  return {
    peer,
    messages,
    loading,
    loadingOlder,
    hasMoreBefore,
    historyError,
    profileOpen,
    open,
    attachReader,
    resync,
    loadOlder,
    append,
    replace,
    remove,
    markSentRead,
    noteLatestRendered,
    noteRealtimeRendered,
    toggleProfile,
    closeProfile,
    close
  };
}
