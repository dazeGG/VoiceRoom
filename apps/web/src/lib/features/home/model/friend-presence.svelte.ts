// Which friends are online, as the realtime stream reports it. The `ready`
// snapshot can arrive before the first friends fetch finishes, so the snapshot
// is kept and a later fetch still takes its online flags; a friend the snapshot
// does not know yet (added since) is seeded from that fetch.

import { SvelteSet } from 'svelte/reactivity';

export class FriendPresence {
  #ready = false;
  #online = new SvelteSet<string>();
  #known = new SvelteSet<string>();

  /** Online according to presence, or `fallback` while presence knows nothing of them. */
  onlineOr(userId: string, fallback = false): boolean {
    return this.#ready && this.#known.has(userId) ? this.#online.has(userId) : fallback;
  }

  /** The realtime `ready` snapshot: `onlineIds` online, every other known friend offline. */
  snapshot(onlineIds: Iterable<string>, friendIds: Iterable<string>): void {
    this.#online = new SvelteSet(onlineIds);
    this.#known = new SvelteSet(friendIds);
    for (const userId of this.#online) this.#known.add(userId);
    this.#ready = true;
  }

  set(userId: string, online: boolean): void {
    this.#known.add(userId);
    if (online) this.#online.add(userId);
    else this.#online.delete(userId);
  }

  /** Friends from a fresh fetch that presence has not heard of yet take the fetch's flag. */
  seed(friends: Iterable<{ userId: string; online: boolean }>): void {
    if (!this.#ready) return;
    for (const friend of friends) {
      if (this.#known.has(friend.userId)) continue;
      this.set(friend.userId, friend.online);
    }
  }

  get ready(): boolean {
    return this.#ready;
  }

  reset(): void {
    this.#ready = false;
    this.#online = new SvelteSet();
    this.#known = new SvelteSet();
  }
}
