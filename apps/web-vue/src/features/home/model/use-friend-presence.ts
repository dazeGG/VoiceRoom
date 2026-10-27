// Which friends are online, as the realtime stream reports it. The `ready`
// snapshot can arrive before the first friends fetch finishes, so the snapshot
// is kept and a later fetch still takes its online flags; a friend the snapshot
// does not know yet (added since) is seeded from that fetch.

import { reactive, ref } from 'vue';

export function useFriendPresence() {
  const ready = ref(false);
  const online = reactive(new Set<string>());
  const known = reactive(new Set<string>());

  /** Online according to presence, or `fallback` while presence knows nothing of them. */
  function onlineOr(userId: string, fallback = false): boolean {
    return ready.value && known.has(userId) ? online.has(userId) : fallback;
  }

  function set(userId: string, isOnline: boolean): void {
    known.add(userId);
    if (isOnline) online.add(userId);
    else online.delete(userId);
  }

  /** The realtime `ready` snapshot: `onlineIds` online, every other known friend offline. */
  function snapshot(onlineIds: readonly string[], friendIds: readonly string[]): void {
    online.clear();
    for (const userId of onlineIds) online.add(userId);
    known.clear();
    for (const userId of friendIds) known.add(userId);
    for (const userId of online) known.add(userId);
    ready.value = true;
  }

  /** Friends from a fresh fetch that presence has not heard of yet take the fetch's flag. */
  function seed(friends: readonly { userId: string; online: boolean }[]): void {
    if (!ready.value) return;
    for (const friend of friends) {
      if (known.has(friend.userId)) continue;
      set(friend.userId, friend.online);
    }
  }

  function reset(): void {
    ready.value = false;
    online.clear();
    known.clear();
  }

  return { ready, onlineOr, snapshot, set, seed, reset };
}
