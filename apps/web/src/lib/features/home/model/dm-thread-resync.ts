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

type ActiveResync = {
  peerId: string;
  mutations: ThreadMutation[];
  forceRequested: boolean;
  promise: Promise<void>;
};

type ThreadResyncOptions = {
  fetchSnapshot: (peerId: string) => Promise<ThreadSnapshot>;
  isCurrent: (peerId: string) => boolean;
  applySnapshot: (peerId: string, snapshot: ThreadSnapshot) => void;
  isOwnMessage: (message: DirectMessage) => boolean;
};

type ResyncRequestOptions = {
  force?: boolean;
};

function newestTimestamp(left: number | null, right: number | null): number | null {
  if (left == null) return right;
  if (right == null) return left;
  return Math.max(left, right);
}

function contentVersion(message: DirectMessage): number {
  return message.editedAt ?? message.createdAt;
}

function mergeMessage(existing: DirectMessage, incoming: DirectMessage): DirectMessage {
  // The HTTP snapshot can already contain a later edit than an event buffered
  // while that request was in flight. Keep the snapshot on version ties and
  // merge read state independently because it advances on a separate timeline.
  const content = contentVersion(incoming) > contentVersion(existing) ? incoming : existing;
  const readAt = newestTimestamp(existing.readAt, incoming.readAt);
  return content.readAt === readAt ? content : { ...content, readAt };
}

function upsertMessage(messages: DirectMessage[], incoming: DirectMessage): DirectMessage[] {
  const index = messages.findIndex((existing) => existing.id === incoming.id);
  if (index === -1) return [...messages, incoming];
  const next = [...messages];
  next[index] = mergeMessage(messages[index], incoming);
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
      messages = messages.map((message) => {
        if (!isOwnMessage(message)) return message;
        const readAt = newestTimestamp(message.readAt, mutation.readAt);
        return message.readAt === readAt ? message : { ...message, readAt };
      });
    }
  }
  return messages;
}

export function createDmThreadResyncCoordinator(options: ThreadResyncOptions) {
  let activeResync: ActiveResync | null = null;

  function record(mutation: ThreadMutation): void {
    if (activeResync?.peerId === mutation.peerId) activeResync.mutations.push(mutation);
  }

  async function runResync(request: ActiveResync): Promise<void> {
    let latestSnapshot: ThreadSnapshot | null = null;
    let lastError: unknown;

    try {
      while (activeResync === request) {
        request.forceRequested = false;
        try {
          latestSnapshot = await options.fetchSnapshot(request.peerId);
          lastError = undefined;
        } catch (error) {
          lastError = error;
        }

        if (activeResync !== request || !options.isCurrent(request.peerId)) return;
        if (request.forceRequested) continue;
        if (!latestSnapshot) throw lastError;

        options.applySnapshot(request.peerId, {
          peer: latestSnapshot.peer,
          messages: replayMutations(latestSnapshot.messages, request.mutations, options.isOwnMessage)
        });
        return;
      }
    } finally {
      if (activeResync === request) activeResync = null;
    }
  }

  return {
    resync(peerId: string, requestOptions: ResyncRequestOptions = {}): Promise<void> {
      if (activeResync?.peerId === peerId) {
        // Reconnect is one logical operation with an initial load. Queue a
        // fresh snapshot without detaching the original caller or discarding a
        // successful fallback when the refresh itself fails.
        if (requestOptions.force) activeResync.forceRequested = true;
        return activeResync.promise;
      }

      let resolveRequest!: () => void;
      let rejectRequest!: (reason?: unknown) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const request: ActiveResync = { peerId, mutations: [], forceRequested: false, promise };
      activeResync = request;
      void runResync(request).then(resolveRequest, rejectRequest);
      return promise;
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
      activeResync = null;
    }
  };
}
