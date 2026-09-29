// The DM thread the lobby has open: its messages (paged history when the
// server offers it, the whole thread otherwise), the read cursor to commit once
// the newest message rendered, and the resync that converges it after missed
// events. The lobby decides which peer is open; the thread keeps that peer's
// messages right.

import { fetchThread, fetchThreadPage, type DirectMessage } from '$lib/api/dm';
import type { PublicUser } from '$lib/api/friends';
import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
import { createAnchoredHistory } from '$lib/features/room/room-history.svelte';
import { createDmThreadResyncCoordinator } from './dm-thread-resync';

/** The read candidate without read cursors: mark the whole thread read. */
export const LEGACY_READ = '__legacy__';

export class DmThread {
  peer = $state<PublicUser | null>(null);
  messages = $state<DirectMessage[]>([]);
  loading = $state(false);
  loadingOlder = $state(false);
  hasMoreBefore = $state(false);
  historyEnabled = $state(false);
  readCursorEnabled = $state(false);
  /** The cursor to mark read once the newest message rendered (LEGACY_READ without read cursors). */
  readCandidate = $state<string | null>(null);
  readRevision = $state(0);
  historyError = $state('');
  profileOpen = $state(false);

  #isOpen: (peerId: string) => boolean;
  #onSnapshot: (peerId: string, messages: DirectMessage[]) => void;

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

  #resync: ReturnType<typeof createDmThreadResyncCoordinator>;

  constructor(options: {
    /** Whether the lobby still shows this peer's thread. */
    isOpen: (peerId: string) => boolean;
    /** A full thread arrived: the lobby updates the friend's summary. */
    onSnapshot: (peerId: string, messages: DirectMessage[]) => void;
    isOwnMessage: (message: DirectMessage) => boolean;
  }) {
    this.#isOpen = options.isOpen;
    this.#onSnapshot = options.onSnapshot;
    this.#resync = createDmThreadResyncCoordinator({
      fetchSnapshot: fetchThread,
      isCurrent: (peerId) => this.#isOpen(peerId),
      applySnapshot: (peerId, { peer, messages }) => {
        this.peer = peer;
        this.messages = messages;
        this.#onSnapshot(peerId, messages);
      },
      isOwnMessage: options.isOwnMessage
    });
  }

  /** Shows `peerId`'s thread, starting from the friend's known profile. */
  async open(peerId: string, peer: PublicUser | null): Promise<void> {
    this.close();
    this.loading = true;
    this.messages = [];
    this.readCandidate = null;
    this.historyError = '';
    if (peer) this.peer = peer;
    try {
      const [historyEnabled, readCursorEnabled] = await Promise.all([
        getCapabilityFeature('historyCursor'),
        getCapabilityFeature('readCursor')
      ]).catch(() => [false, false] as const);
      if (!this.#isOpen(peerId)) return;
      this.historyEnabled = historyEnabled;
      this.readCursorEnabled = readCursorEnabled;
      if (historyEnabled) await this.#history.open(peerId);
      else {
        this.#history.close();
        await this.#resync.resync(peerId);
      }
      if (this.#isOpen(peerId)) this.noteLatestRendered();
    } finally {
      if (this.#isOpen(peerId)) this.loading = false;
    }
  }

  /** Converges the open thread with the server after events may have been missed. */
  async resync(peerId: string, options: { force?: boolean } = {}): Promise<void> {
    if (this.historyEnabled) {
      const page = await fetchThreadPage(peerId, { mode: 'latest' });
      if (!this.#isOpen(peerId)) return;
      const firstCreatedAt = page.messages[0]?.createdAt;
      this.#history.reconcileLatest(
        page.messages,
        (message) => firstCreatedAt == null || message.createdAt >= firstCreatedAt
      );
    } else {
      await this.#resync.resync(peerId, options);
    }
    this.noteLatestRendered();
  }

  loadOlder(scrollElement: HTMLElement | null): Promise<void> {
    return this.historyEnabled ? this.#history.loadOlder(scrollElement) : Promise.resolve();
  }

  /** Adds a message the open thread shows (sent here or arrived live). */
  append(incoming: DirectMessage): void {
    // A link preview can arrive as an edit before the message itself is
    // delivered; the later, preview-less copy must not wipe it.
    const known = this.messages.find((existing) => existing.id === incoming.id);
    const message =
      known?.linkPreview && !incoming.linkPreview ? { ...incoming, linkPreview: known.linkPreview } : incoming;
    if (this.historyEnabled) this.#history.upsert(message);
    else if (!this.messages.some((existing) => existing.id === message.id)) {
      this.messages = [...this.messages, message];
    }
  }

  replace(message: DirectMessage): void {
    if (this.historyEnabled) this.#history.upsert(message);
    else this.messages = this.messages.map((existing) => (existing.id === message.id ? message : existing));
  }

  remove(messageId: string): void {
    if (this.historyEnabled) this.#history.remove(messageId);
    else this.messages = this.messages.filter((message) => message.id !== messageId);
  }

  /** The peer read everything: our sent messages show as read. */
  markSentRead(isOwnMessage: (message: DirectMessage) => boolean, at: number): void {
    this.messages = this.messages.map((message) =>
      isOwnMessage(message) && message.readAt == null ? { ...message, readAt: at } : message
    );
  }

  /** Remembers a change to any thread, so a later resync of it keeps the change. */
  recordUpsert(peerId: string, message: DirectMessage): void {
    this.#resync.recordUpsert(peerId, message);
  }

  recordDelete(peerId: string, messageId: string): void {
    this.#resync.recordDelete(peerId, messageId);
  }

  recordRead(peerId: string, at: number): void {
    this.#resync.recordRead(peerId, at);
  }

  noteLatestRendered(cursor?: string): void {
    const candidate = cursor || [...this.messages].reverse().find((message) => message.readCursor)?.readCursor;
    this.readCandidate = this.readCursorEnabled ? (candidate ?? null) : LEGACY_READ;
    this.readRevision += 1;
  }

  /** A live message rendered; without its cursor, the thread resyncs to learn it. */
  async noteRealtimeRendered(peerId: string, message: DirectMessage): Promise<void> {
    if (message.readCursor || !this.readCursorEnabled) {
      this.noteLatestRendered(message.readCursor);
      return;
    }
    if (!this.#isOpen(peerId)) return;
    await this.resync(peerId, { force: true }).catch(() => {});
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
    this.#resync.invalidate();
  }
}
