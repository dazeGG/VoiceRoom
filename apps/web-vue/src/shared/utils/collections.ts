// List helpers for the rune modules: a Map or Set built inside a .svelte.ts
// export reads as state that should be reactive, so the plain ones live here.

/** One item per key, in the order each key first appears; a later duplicate replaces the earlier one. */
export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

/** The keys of the items, for membership checks. */
export function keysOf<T>(items: readonly T[], key: (item: T) => string): ReadonlySet<string> {
  return new Set(items.map(key));
}

/**
 * The current items with the new ones merged in by id: a known id takes the
 * new item's defined fields over the current ones, an unknown id is added.
 * Items without an id are skipped.
 */
export function mergeById<T extends { id: string }>(current: readonly T[], items: readonly T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of items) {
    if (!item?.id) continue;
    const known = byId.get(item.id);
    if (!known) {
      byId.set(item.id, item);
      continue;
    }
    const defined = Object.fromEntries(Object.entries<unknown>(item).filter(([, value]) => value !== undefined));
    byId.set(item.id, { ...known, ...defined });
  }
  return Array.from(byId.values());
}
