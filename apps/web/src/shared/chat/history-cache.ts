// The newest messages of recently open conversations, so reopening one shows
// them at once while its newest page loads. In memory only, and dropped when
// the session ends: another account on this computer must not see them.
//
// One cache per kind of message (room, direct), so each gives back the type it
// was given; the limit on kept conversations counts them all together.

const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 100;

interface KeptConversation {
  drop: () => void;
}

// Ordered by last use across every cache: the first one is the one to drop.
const lastUse = new Set<KeptConversation>();

export interface HistoryCache<T> {
  read(scope: string): T[] | undefined;
  write(scope: string, messages: T[]): void;
}

/**
 * `copy` takes plain data out of the messages a page shows (`plainSnapshot`),
 * so the kept copy does not follow later changes to them.
 */
export function createHistoryCache<T>(copy: (messages: T[]) => T[]): HistoryCache<T> {
  const kept = new Map<string, { messages: readonly T[]; use: KeptConversation }>();

  function drop(scope: string): void {
    const entry = kept.get(scope);
    if (!entry) return;
    kept.delete(scope);
    lastUse.delete(entry.use);
  }

  return {
    read(scope) {
      const entry = kept.get(scope);
      if (!entry) return undefined;
      lastUse.delete(entry.use);
      lastUse.add(entry.use);
      return [...entry.messages];
    },
    write(scope, messages) {
      drop(scope);
      if (messages.length === 0) return;
      const use = { drop: () => drop(scope) };
      kept.set(scope, { messages: copy(messages.slice(-MAX_MESSAGES)), use });
      lastUse.add(use);
      for (const oldest of lastUse) {
        if (lastUse.size <= MAX_CONVERSATIONS) break;
        oldest.drop();
      }
    }
  };
}

export function clearHistoryCache(): void {
  for (const use of [...lastUse]) use.drop();
}
