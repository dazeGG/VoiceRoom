import type { ReactionSummary, Reactor } from '@voice-room/shared/reactions';
import {
  fetchReactionSummaries,
  fetchReactors,
  setReactionDesired,
  type ReactionConversation
} from '$lib/api/reactions';

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
  conversation = $state<ReactionConversation | null>(null);
  summaries = $state<Record<string, ReactionView[]>>({});
  reactors = $state<Record<string, ReactorListState>>({});
  deletedMessages = $state<Record<string, true>>({});
  loadingMessages = $state<Record<string, true>>({});
  private requestSequence = 0;
  private reactorRequests: Record<string, number> = {};

  private conversationKey(): string {
    return this.conversation ? `${this.conversation.type}:${this.conversation.id}` : '';
  }

  private invalidateReactors(messageId?: string): void {
    for (const key of Object.keys(this.reactorRequests)) {
      if (!messageId || key.startsWith(`${messageId}\u0000`)) delete this.reactorRequests[key];
    }
  }

  setConversation(conversation: ReactionConversation): void {
    if (this.conversation?.type === conversation.type && this.conversation.id === conversation.id) return;
    this.conversation = { ...conversation };
    this.summaries = {};
    this.reactors = {};
    this.deletedMessages = {};
    this.loadingMessages = {};
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
    const next = { ...this.summaries };
    delete next[messageId];
    this.summaries = next;
    const reactorEntries = { ...this.reactors };
    for (const key of Object.keys(reactorEntries)) {
      if (key.startsWith(`${messageId}\u0000`)) delete reactorEntries[key];
    }
    this.reactors = reactorEntries;
    this.invalidateReactors(messageId);
  }

  replace(messageId: string, summaries: ReactionSummary[]): void {
    if (this.isDeleted(messageId)) return;
    for (const summary of summaries) this.applyServer(messageId, summary);
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

  async load(messageId: string): Promise<void> {
    const conversation = this.conversation;
    if (!conversation || this.loadingMessages[messageId] || this.isDeleted(messageId)) return;
    this.loadingMessages = { ...this.loadingMessages, [messageId]: true };
    try {
      this.replace(messageId, await fetchReactionSummaries(conversation, messageId));
    } finally {
      const next = { ...this.loadingMessages };
      delete next[messageId];
      this.loadingMessages = next;
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
      if (this.isDeleted(messageId) || this.conversationKey() !== `${conversation.type}:${conversation.id}`) return false;
      const latest = [...this.forMessage(messageId)];
      const latestIndex = latest.findIndex((item) => item.emoji === emoji);
      if (latestIndex >= 0) latest[latestIndex] = { ...latest[latestIndex], pending: false };
      this.summaries = { ...this.summaries, [messageId]: latest };
      this.applyServer(messageId, authoritative);
      return true;
    } catch (error) {
      if (this.isDeleted(messageId) || this.conversationKey() !== `${conversation.type}:${conversation.id}`) return false;
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
    return this.reactors[reactorKey(messageId, emoji)] || {
      reactors: [], nextCursor: null, loading: false, error: ''
    };
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
      if (this.reactorRequests[key] !== requestId || this.conversationKey() !== conversationKey || this.isDeleted(messageId)) return;
      const candidates = append ? [...current.reactors, ...page.reactors] : page.reactors;
      const reactors = [...new Map(candidates.map((reactor) => [reactor.userId, reactor])).values()];
      this.reactors = {
        ...this.reactors,
        [key]: { reactors, nextCursor: page.nextCursor, loading: false, error: '' }
      };
    } catch (error) {
      if (this.reactorRequests[key] !== requestId || this.conversationKey() !== conversationKey || this.isDeleted(messageId)) return;
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
    this.invalidateReactors();
  }
}

export function createReactionStore(): ReactionStore {
  return new ReactionStore();
}

export const reactionStore = createReactionStore();
