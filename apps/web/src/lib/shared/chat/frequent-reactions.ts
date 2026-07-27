export interface FrequentReaction {
  emoji: string;
  count: number;
  lastUsedAt: number;
}

const DATABASE_NAME = 'voice-room-local-preferences';
const DATABASE_VERSION = 1;
const STORE_NAME = 'frequent-reactions';
const STORAGE_PREFIX = 'voice-room:frequent-reactions';
export const DEFAULT_FREQUENT_REACTIONS = ['👍', '❤️', '😂'] as const;

const memory = new Map<string, FrequentReaction[]>();

export function frequentReactionKey(namespace: string, userId: string): string {
  return `${namespace}:${userId}`;
}

export function rankFrequentReactions(
  entries: readonly FrequentReaction[],
  limit = 3
): FrequentReaction[] {
  const byEmoji = new Map<string, FrequentReaction>();
  for (const entry of entries) {
    if (!entry.emoji) continue;
    const previous = byEmoji.get(entry.emoji);
    if (!previous || entry.count > previous.count || (entry.count === previous.count && entry.lastUsedAt > previous.lastUsedAt)) {
      byEmoji.set(entry.emoji, {
        emoji: entry.emoji,
        count: Math.max(0, entry.count),
        lastUsedAt: Math.max(0, entry.lastUsedAt)
      });
    }
  }
  return [...byEmoji.values()]
    .sort((left, right) => right.count - left.count || right.lastUsedAt - left.lastUsedAt || left.emoji.localeCompare(right.emoji))
    .slice(0, limit);
}

function seededEntries(): FrequentReaction[] {
  return DEFAULT_FREQUENT_REACTIONS.map((emoji, index) => ({
    emoji,
    count: 0,
    lastUsedAt: DEFAULT_FREQUENT_REACTIONS.length - index
  }));
}

function normalizeEntries(value: unknown): FrequentReaction[] {
  if (!Array.isArray(value)) return seededEntries();
  const entries = value.flatMap((entry): FrequentReaction[] => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<FrequentReaction>;
    if (typeof candidate.emoji !== 'string') return [];
    return [{
      emoji: candidate.emoji,
      count: Number.isFinite(candidate.count) ? Math.max(0, Number(candidate.count)) : 0,
      lastUsedAt: Number.isFinite(candidate.lastUsedAt) ? Math.max(0, Number(candidate.lastUsedAt)) : 0
    }];
  });
  const seen = new Set(entries.map((entry) => entry.emoji));
  for (const seed of seededEntries()) {
    if (!seen.has(seed.emoji)) entries.push(seed);
  }
  return rankFrequentReactions(entries, Math.max(12, entries.length));
}

function localStorageKey(key: string): string {
  return `${STORAGE_PREFIX}:${key}`;
}

function readLocalStorage(key: string): FrequentReaction[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(localStorageKey(key));
    return raw ? normalizeEntries(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, entries: FrequentReaction[]): void {
  try {
    globalThis.localStorage?.setItem(localStorageKey(key), JSON.stringify(entries));
  } catch {
    // Memory remains the final fallback when browser persistence is unavailable.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

async function readIndexedDb(key: string): Promise<FrequentReaction[] | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ? normalizeEntries(request.result) : null);
      request.onerror = () => reject(request.error ?? new Error('Could not read frequent reactions'));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedDb(key: string, entries: FrequentReaction[]): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entries, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Could not save frequent reactions'));
    });
  } finally {
    database.close();
  }
}

export async function loadFrequentReactions(namespace: string, userId: string): Promise<string[]> {
  if (!userId) return [...DEFAULT_FREQUENT_REACTIONS];
  const key = frequentReactionKey(namespace, userId);
  const cached = memory.get(key);
  if (cached) return rankFrequentReactions(cached).map((entry) => entry.emoji);

  let entries: FrequentReaction[] | null = null;
  try {
    entries = await readIndexedDb(key);
  } catch {
    entries = readLocalStorage(key);
  }
  const normalized = normalizeEntries(entries);
  memory.set(key, normalized);
  return rankFrequentReactions(normalized).map((entry) => entry.emoji);
}

export async function recordFrequentReaction(
  namespace: string,
  userId: string,
  emoji: string,
  now = Date.now()
): Promise<string[]> {
  if (!userId || !emoji) return loadFrequentReactions(namespace, userId);
  const key = frequentReactionKey(namespace, userId);
  if (!memory.has(key)) await loadFrequentReactions(namespace, userId);
  const entries = normalizeEntries(memory.get(key));
  const existing = entries.find((entry) => entry.emoji === emoji);
  if (existing) {
    existing.count += 1;
    existing.lastUsedAt = now;
  } else {
    entries.push({ emoji, count: 1, lastUsedAt: now });
  }
  const ranked = rankFrequentReactions(entries, Math.max(12, entries.length));
  memory.set(key, ranked);
  try {
    await writeIndexedDb(key, ranked);
  } catch {
    writeLocalStorage(key, ranked);
  }
  return rankFrequentReactions(ranked).map((entry) => entry.emoji);
}
