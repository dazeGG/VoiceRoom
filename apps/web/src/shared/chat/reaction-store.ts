import { markRaw, ref } from 'vue';
import { MAX_REACTION_BATCH, type ReactionSummary, type Reactor } from '@voice-room/shared/contracts/messages';
import { fetchReactionBatch, fetchReactors, setReactionDesired, type ReactionConversation } from '@/api/reactions';
import { replaceReactionSnapshot } from './reaction-reconciliation';
import { createLogger, errorContext } from '@/shared/log';
import { uniqueBy } from '@/shared/utils/collections';

const log = createLogger('chat:reactions');

export type ReactionView = ReactionSummary & { pending: boolean; error: string };
export type ReactorListState = {
  reactors: Reactor[];
  nextCursor: string | null;
  loading: boolean;
  error: string;
};

function revision(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function reactorKey(messageId: string, emoji: string): string {
  return `${messageId}\u0000${emoji}`;
}

function cleanView(summary: ReactionSummary, previous?: ReactionView): ReactionView {
  return {
    ...summary,
    count: Math.max(0, summary.count),
    pending: previous?.pending ?? false,
    error: ''
  };
}

export class ReactionStore {
  readonly #conversation = ref<ReactionConversation | null>(null);
  readonly #summaries = ref<Record<string, ReactionView[]>>({});
  readonly #reactors = ref<Record<string, ReactorListState>>({});
  readonly #deletedMessages = ref<Record<string, true>>({});
  readonly #loadingMessages = ref<Record<string, true>>({});
  private requestSequence = 0;
  private reactorRequests: Record<string, number> = {};
  // Messages whose reactions were asked for. Plain, not reactive: a chat calls
  // load() from an effect, and reactive loading state read there would re-run
  // that effect after every answer and fetch again forever.
  private requested: Record<string, true> = {};
  // The page snapshot each message's reactions were last taken from. Plain, as above.
  private snapshots: Record<string, string> = {};
  // Messages to ask about in the next request. A chat shows them in one go, so
  // they go in one request: asked for one by one, a long chat took every
  // database connection the server has and held a join up behind them.
  private queued: string[] = [];
  private flushing: Promise<void> | null = null;

  constructor() {
    markRaw(this);
  }

  get conversation(): ReactionConversation | null {
    return this.#conversation.value;
  }
  set conversation(value: ReactionConversation | null) {
    this.#conversation.value = value;
  }
  get summaries(): Record<string, ReactionView[]> {
    return this.#summaries.value;
  }
  set summaries(value: Record<string, ReactionView[]>) {
    this.#summaries.value = value;
  }
  get reactors(): Record<string, ReactorListState> {
    return this.#reactors.value;
  }
  set reactors(value: Record<string, ReactorListState>) {
    this.#reactors.value = value;
  }
  get deletedMessages(): Record<string, true> {
    return this.#deletedMessages.value;
  }
  set deletedMessages(value: Record<string, true>) {
    this.#deletedMessages.value = value;
  }
  get loadingMessages(): Record<string, true> {
    return this.#loadingMessages.value;
  }
  set loadingMessages(value: Record<string, true>) {
    this.#loadingMessages.value = value;
  }

  private conversationKey(): string {
    return this.conversation ? `${this.conversation.type}:${this.conversation.id}` : '';
  }

  private invalidateReactors(messageId?: string): void {
    this.reactorRequests = messageId
      ? Object.fromEntries(
          Object.entries(this.reactorRequests).filter(([key]) => !key.startsWith(`${messageId}\u0000`))
        )
      : {};
  }

  setConversation(conversation: ReactionConversation): void {
    if (this.conversation?.type === conversation.type && this.conversation.id === conversation.id) return;
    this.conversation = { ...conversation };
    this.summaries = {};
    this.reactors = {};
    this.deletedMessages = {};
    this.loadingMessages = {};
    this.requested = {};
    this.snapshots = {};
    this.invalidateReactors();
  }

  forMessage(messageId: string): ReactionView[] {
    return this.summaries[messageId] || [];
  }

  isDeleted(messageId: string): boolean {
    return this.deletedMessages[messageId] === true;
  }

  markDeleted(messageId: string): void {
    this.deletedMessages = { ...this.deletedMessages, [messageId]: true };
    const { [messageId]: _deleted, ...summaries } = this.summaries;
    this.summaries = summaries;
    this.reactors = Object.fromEntries(
      Object.entries(this.reactors).filter(([key]) => !key.startsWith(`${messageId}\u0000`))
    );
    this.invalidateReactors(messageId);
  }

  replace(messageId: string, summaries: ReactionSummary[]): void {
    if (this.isDeleted(messageId)) return;
    this.summaries = {
      ...this.summaries,
      [messageId]: replaceReactionSnapshot(this.forMessage(messageId), summaries)
    };
  }

  applyServer(messageId: string, summary: ReactionSummary): void {
    if (this.isDeleted(messageId)) return;
    const items = [...this.forMessage(messageId)];
    const index = items.findIndex((item) => item.emoji === summary.emoji);
    const current = index >= 0 ? items[index] : undefined;
    if (current && revision(summary.revision) < revision(current.revision)) return;
    const next = cleanView(summary, current);
    if (next.count === 0 && !next.pending) {
      if (index >= 0) items.splice(index, 1);
    } else if (index >= 0) {
      items[index] = next;
    } else {
      items.push(next);
    }
    this.summaries = { ...this.summaries, [messageId]: items };
  }

  /**
   * Shows a message's reactions: those its history page carried, or fetched
   * once when it came without them (a live message, a guest's recent window).
   */
  show(message: { id: string; reactions?: ReactionSummary[] | undefined }): void {
    if (!message.reactions) {
      void this.load(message.id);
      return;
    }
    // Only a snapshot not taken yet replaces what is shown: a message keeps
    // its page's copy while realtime events move the store past it.
    const signature = message.reactions
      .map((item) => `${item.emoji}:${item.count}:${item.reactedByMe}:${item.revision}`)
      .join('|');
    if (this.snapshots[message.id] === signature) return;
    this.snapshots[message.id] = signature;
    this.requested[message.id] = true;
    const summaries = message.reactions;
    this.replace(message.id, summaries);
  }

  /** Fetches a message's reactions once; realtime events keep them current after that. */
  load(messageId: string): Promise<void> {
    if (this.requested[messageId]) return Promise.resolve();
    if (!this.conversation || this.isDeleted(messageId)) return Promise.resolve();
    this.requested[messageId] = true;
    this.loadingMessages = { ...this.loadingMessages, [messageId]: true };
    this.queued.push(messageId);
    this.flushing ??= Promise.resolve().then(() => this.flush());
    return this.flushing;
  }

  private async flush(): Promise<void> {
    const messageIds = this.queued;
    const conversation = this.conversation;
    this.queued = [];
    this.flushing = null;
    if (!conversation) return;
    for (let start = 0; start < messageIds.length; start += MAX_REACTION_BATCH) {
      const batch = messageIds.slice(start, start + MAX_REACTION_BATCH);
      try {
        const answer = await fetchReactionBatch(conversation, batch);
        // A view moved on to another conversation in the meantime has reset all this.
        if (this.conversation !== conversation) return;
        for (const messageId of batch) this.replace(messageId, answer[messageId] ?? []);
      } catch (error) {
        // Asked again the next time they are shown.
        if (this.conversation !== conversation) return;
        const failed = new Set(batch);
        this.requested = Object.fromEntries(Object.entries(this.requested).filter(([id]) => !failed.has(id)));
        log.warn('reactions did not load', errorContext(error));
      }
      const done = new Set(batch);
      this.loadingMessages = Object.fromEntries(Object.entries(this.loadingMessages).filter(([id]) => !done.has(id)));
    }
  }

  async toggle(messageId: string, emoji: string): Promise<boolean> {
    const conversation = this.conversation;
    if (!conversation || this.isDeleted(messageId)) return false;
    const items = [...this.forMessage(messageId)];
    const index = items.findIndex((item) => item.emoji === emoji);
    const current = index >= 0 ? items[index] : undefined;
    if (current?.pending) return false;
    const desired = !current?.reactedByMe;
    const optimistic: ReactionView = {
      emoji,
      count: Math.max(0, (current?.count || 0) + (desired ? 1 : -1)),
      reactedByMe: desired,
      revision: current?.revision || '0',
      pending: true,
      error: ''
    };
    if (index >= 0) items[index] = optimistic;
    else items.push(optimistic);
    this.summaries = { ...this.summaries, [messageId]: items };

    try {
      const authoritative = await setReactionDesired(conversation, messageId, emoji, desired);
      if (this.isDeleted(messageId) || this.conversationKey() !== `${conversation.type}:${conversation.id}`)
        return false;
      const latest = [...this.forMessage(messageId)];
      const latestIndex = latest.findIndex((item) => item.emoji === emoji);
      const settled = latest[latestIndex];
      if (settled) latest[latestIndex] = { ...settled, pending: false };
      this.summaries = { ...this.summaries, [messageId]: latest };
      this.applyServer(messageId, authoritative);
      return true;
    } catch (error) {
      if (this.isDeleted(messageId) || this.conversationKey() !== `${conversation.type}:${conversation.id}`)
        return false;
      const latest = [...this.forMessage(messageId)];
      const latestIndex = latest.findIndex((item) => item.emoji === emoji);
      if (current) {
        const restored = {
          ...current,
          pending: false,
          error: error instanceof Error ? error.message : 'Не удалось изменить реакцию'
        };
        if (latestIndex >= 0) latest[latestIndex] = restored;
        else latest.push(restored);
      } else if (latestIndex >= 0) {
        latest.splice(latestIndex, 1);
      }
      this.summaries = { ...this.summaries, [messageId]: latest };
      return false;
    }
  }

  reactorState(messageId: string, emoji: string): ReactorListState {
    return (
      this.reactors[reactorKey(messageId, emoji)] || {
        reactors: [],
        nextCursor: null,
        loading: false,
        error: ''
      }
    );
  }

  async loadReactors(messageId: string, emoji: string, append = false): Promise<void> {
    const conversation = this.conversation;
    if (!conversation || this.isDeleted(messageId)) return;
    const key = reactorKey(messageId, emoji);
    const current = this.reactorState(messageId, emoji);
    if (current.loading || (append && !current.nextCursor)) return;
    const requestId = ++this.requestSequence;
    const conversationKey = this.conversationKey();
    this.reactorRequests[key] = requestId;
    this.reactors = { ...this.reactors, [key]: { ...current, loading: true, error: '' } };
    try {
      const page = await fetchReactors(conversation, messageId, emoji, {
        cursor: append ? current.nextCursor : null,
        limit: 50
      });
      if (
        this.reactorRequests[key] !== requestId ||
        this.conversationKey() !== conversationKey ||
        this.isDeleted(messageId)
      )
        return;
      const candidates = append ? [...current.reactors, ...page.reactors] : page.reactors;
      const reactors = uniqueBy(candidates, (reactor) => reactor.userId);
      this.reactors = {
        ...this.reactors,
        [key]: { reactors, nextCursor: page.nextCursor, loading: false, error: '' }
      };
    } catch (error) {
      if (
        this.reactorRequests[key] !== requestId ||
        this.conversationKey() !== conversationKey ||
        this.isDeleted(messageId)
      )
        return;
      this.reactors = {
        ...this.reactors,
        [key]: {
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить список'
        }
      };
    }
  }

  reset(): void {
    this.conversation = null;
    this.summaries = {};
    this.reactors = {};
    this.deletedMessages = {};
    this.loadingMessages = {};
    this.requested = {};
    this.snapshots = {};
    this.invalidateReactors();
  }
}

export function createReactionStore(): ReactionStore {
  return markRaw(new ReactionStore());
}

export const reactionStore = createReactionStore();
