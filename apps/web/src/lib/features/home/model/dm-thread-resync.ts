import type { DirectMessage } from '$lib/api/dm';
import type { PublicUser } from '$lib/api/friends';

type ThreadSnapshot = {
  peer: PublicUser;
  messages: DirectMessage[];
};

type ThreadMutation =
  | { type: 'upsert'; peerId: string; message: DirectMessage }
  | { type: 'delete'; peerId: string; messageId: string }
  | { type: 'read'; peerId: string; readAt: number };

type MutationBatch = {
  activeRequests: number;
  mutations: ThreadMutation[];
};

type ThreadResyncOptions = {
  fetchSnapshot: (peerId: string) => Promise<ThreadSnapshot>;
  isCurrent: (peerId: string) => boolean;
  applySnapshot: (peerId: string, snapshot: ThreadSnapshot) => void;
  isOwnMessage: (message: DirectMessage) => boolean;
};

function upsertMessage(messages: DirectMessage[], message: DirectMessage): DirectMessage[] {
  const index = messages.findIndex((existing) => existing.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

function replayMutations(
  snapshot: DirectMessage[],
  mutations: readonly ThreadMutation[],
  isOwnMessage: (message: DirectMessage) => boolean
): DirectMessage[] {
  let messages = snapshot;
  for (const mutation of mutations) {
    if (mutation.type === 'upsert') {
      messages = upsertMessage(messages, mutation.message);
    } else if (mutation.type === 'delete') {
      messages = messages.filter((message) => message.id !== mutation.messageId);
    } else {
      messages = messages.map((message) =>
        isOwnMessage(message) && message.readAt == null ? { ...message, readAt: mutation.readAt } : message
      );
    }
  }
  return messages;
}

export function createDmThreadResyncCoordinator(options: ThreadResyncOptions) {
  let latestRequestId = 0;
  let mutationBatch: MutationBatch | null = null;

  function record(mutation: ThreadMutation): void {
    mutationBatch?.mutations.push(mutation);
  }

  return {
    async resync(peerId: string): Promise<void> {
      const requestId = ++latestRequestId;
      const batch = mutationBatch ?? { activeRequests: 0, mutations: [] };
      mutationBatch = batch;
      batch.activeRequests += 1;

      try {
        const snapshot = await options.fetchSnapshot(peerId);
        if (requestId !== latestRequestId || !options.isCurrent(peerId)) return;
        const mutations = batch.mutations.filter((mutation) => mutation.peerId === peerId);
        options.applySnapshot(peerId, {
          peer: snapshot.peer,
          messages: replayMutations(snapshot.messages, mutations, options.isOwnMessage)
        });
      } finally {
        batch.activeRequests -= 1;
        if (mutationBatch === batch && batch.activeRequests === 0) mutationBatch = null;
      }
    },

    recordUpsert(peerId: string, message: DirectMessage): void {
      record({ type: 'upsert', peerId, message });
    },

    recordDelete(peerId: string, messageId: string): void {
      record({ type: 'delete', peerId, messageId });
    },

    recordRead(peerId: string, readAt: number): void {
      record({ type: 'read', peerId, readAt });
    },

    invalidate(): void {
      latestRequestId += 1;
      mutationBatch = null;
    }
  };
}
