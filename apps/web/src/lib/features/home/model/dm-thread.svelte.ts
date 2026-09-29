// The DM thread the lobby has open: its paged history anchored at the newest
// message, the read cursor to commit once that message rendered, and the
// resync that converges the newest page after missed events. The lobby decides
// which peer is open; the thread keeps that peer's messages right.

import { fetchThreadPage, type DirectMessage } from '$lib/api/dm';
import type { PublicUser } from '$lib/api/friends';
import { createAnchoredHistory } from '$lib/features/room/room-history.svelte';

export class DmThread {
  peer = $state<PublicUser | null>(null);
  messages = $state<DirectMessage[]>([]);
  loading = $state(false);
  loadingOlder = $state(false);
  hasMoreBefore = $state(false);
  /** The read cursor to commit once the newest message rendered. */
  readCandidate = $state<string | null>(null);
  readRevision = $state(0);
  historyError = $state('');
  profileOpen = $state(false);

  #isOpen: (peerId: string) => boolean;

  #history = createAnchoredHistory<DirectMessage>({
    loadPage: async (peerId, request) => fetchThreadPage(peerId, request),
    compare: (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    onChange: (state) => {
      this.messages = state.messages;
      this.loading = state.loading;
      this.loadingOlder = state.loadingOlder;
      this.hasMoreBefore = state.hasMoreBefore;
      this.historyError = state.error;
    }
  });

  /** `isOpen` answers whether the lobby still shows this peer's thread. */
  constructor(isOpen: (peerId: string) => boolean) {
    this.#isOpen = isOpen;
  }

  /** Shows `peerId`'s thread, starting from the friend's known profile. */
  async open(peerId: string, peer: PublicUser | null): Promise<void> {
    this.readCandidate = null;
    if (peer) this.peer = peer;
    await this.#history.open(peerId);
    if (this.#isOpen(peerId)) this.noteLatestRendered();
  }

  /** Converges the newest page with the server after events may have been missed. */
  async resync(peerId: string): Promise<void> {
    const page = await fetchThreadPage(peerId, { mode: 'latest' });
    if (!this.#isOpen(peerId)) return;
    const firstCreatedAt = page.messages[0]?.createdAt;
    this.#history.reconcileLatest(
      page.messages,
      (message) => firstCreatedAt == null || message.createdAt >= firstCreatedAt
    );
    this.noteLatestRendered();
  }

  loadOlder(scrollElement: HTMLElement | null): Promise<void> {
    return this.#history.loadOlder(scrollElement);
  }

  /** Adds a message the open thread shows (sent here or arrived live). */
  append(incoming: DirectMessage): void {
    // A link preview can arrive as an edit before the message itself is
    // delivered; the later, preview-less copy must not wipe it.
    const known = this.messages.find((existing) => existing.id === incoming.id);
    this.#history.upsert(
      known?.linkPreview && !incoming.linkPreview ? { ...incoming, linkPreview: known.linkPreview } : incoming
    );
  }

  replace(message: DirectMessage): void {
    this.#history.upsert(message);
  }

  remove(messageId: string): void {
    this.#history.remove(messageId);
  }

  /** The peer read everything: our sent messages show as read. */
  markSentRead(isOwnMessage: (message: DirectMessage) => boolean, at: number): void {
    this.messages = this.messages.map((message) =>
      isOwnMessage(message) && message.readAt == null ? { ...message, readAt: at } : message
    );
  }

  noteLatestRendered(cursor?: string): void {
    this.readCandidate = cursor || this.messages.findLast((message) => message.readCursor)?.readCursor || null;
    this.readRevision += 1;
  }

  /** A live message rendered; without its cursor, the thread resyncs to learn it. */
  async noteRealtimeRendered(peerId: string, message: DirectMessage): Promise<void> {
    if (message.readCursor) {
      this.noteLatestRendered(message.readCursor);
      return;
    }
    if (!this.#isOpen(peerId)) return;
    await this.resync(peerId).catch(() => {});
  }

  toggleProfile = (): void => {
    this.profileOpen = !this.profileOpen;
  };

  closeProfile = (): void => {
    this.profileOpen = false;
  };

  /** Stops loading the thread that was open (another one opens, or the lobby closes). */
  close(): void {
    this.#history.close();
  }
}
