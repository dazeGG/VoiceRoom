// The newest messages of recently open conversations, so reopening one shows
// them at once while its newest page loads. In memory only, and dropped when
// the session ends: another account on this computer must not see them.

const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 100;

// Ordered by last use: the first key is the one to drop.
const cache = new Map<string, readonly unknown[]>();

export function readHistoryCache<T>(key: string): T[] | undefined {
  const messages = cache.get(key);
  if (!messages) return undefined;
  cache.delete(key);
  cache.set(key, messages);
  return [...messages] as T[];
}

export function writeHistoryCache<T>(key: string, messages: readonly T[]): void {
  cache.delete(key);
  if (messages.length === 0) return;
  cache.set(key, messages.slice(-MAX_MESSAGES));
  while (cache.size > MAX_CONVERSATIONS) cache.delete(cache.keys().next().value as string);
}

export function clearHistoryCache(): void {
  cache.clear();
}
