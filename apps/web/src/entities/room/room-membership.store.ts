import { t } from '@/shared/i18n';
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { MembershipMember } from '@voice-room/shared/contracts/membership';
import { fetchRoomMemberships, leaveRoomMembership } from '@/api/memberships';
import { ApiError } from '@/api/client';
import { removeStorage } from '@/shared/storage';

interface RoomMembershipEntry {
  cachedMembers: MembershipMember[];
  members: MembershipMember[];
  query: string;
  nextCursor?: string | undefined;
  hasMore: boolean;
  presenceRevision: number;
  loaded: boolean;
  loading: boolean;
  requestGeneration: number;
  error: string;
  setError: (source: () => string) => void;
}

const LEGACY_PREFIX = 'voice-room:membership:v1:';
const CACHE_PREFIX = 'voice-room:membership:v2:';
function purge(prefix: string): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}
/** What persist() writes; a revision that does not read as a number counts as none. */
const CachedMembership = Type.Object({
  viewerId: Type.String(),
  members: Type.Array(MembershipMember),
  presenceRevision: Type.Optional(Type.Unknown())
});

function emptyEntry(): RoomMembershipEntry {
  const error = useLocalizedText();
  return {
    cachedMembers: [],
    members: [],
    query: '',
    hasMore: false,
    presenceRevision: 0,
    loaded: false,
    loading: false,
    requestGeneration: 0,
    get error() {
      return error.value;
    },
    set error(value: string) {
      error.value = value;
    },
    setError: (source) => {
      error.value = source;
    }
  };
}

function cacheKey(viewerId: string, roomId: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(viewerId)}:${encodeURIComponent(roomId)}`;
}

function readCache(viewerId: string, roomId: string): RoomMembershipEntry | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(viewerId, roomId)) || 'null');
    if (!Value.Check(CachedMembership, parsed) || parsed.viewerId !== viewerId) return null;
    return Object.assign(emptyEntry(), {
      cachedMembers: parsed.members,
      members: parsed.members,
      presenceRevision: Number(parsed.presenceRevision) || 0,
      loaded: true
    });
  } catch {
    return null;
  }
}

function persist(viewerId: string, roomId: string, entry: RoomMembershipEntry): void {
  try {
    localStorage.setItem(
      cacheKey(viewerId, roomId),
      JSON.stringify({
        viewerId,
        members: entry.cachedMembers,
        presenceRevision: entry.presenceRevision
      })
    );
  } catch {
    // Storage is an offline optimization; privacy mode/quota must not break roster loading.
  }
}

function mergeMembers(current: MembershipMember[], incoming: MembershipMember[]): MembershipMember[] {
  const merged = [...current];
  for (const member of incoming) {
    const index = merged.findIndex((known) => known.userId === member.userId);
    if (index === -1) merged.push(member);
    else merged[index] = { ...merged[index], ...member };
  }
  return merged.sort(
    (left, right) => Number(right.presenceStatus !== 'offline') - Number(left.presenceStatus !== 'offline')
  );
}

export const useRoomMembershipStore = defineStore('room-membership', () => {
  purge(LEGACY_PREFIX);
  let viewerId: string | null = null;
  let authGeneration = 0;
  const byRoomId = ref<Record<string, RoomMembershipEntry>>({});

  function resetViewer(next: string | null, generation: number): void {
    if (viewerId) purge(`${CACHE_PREFIX}${encodeURIComponent(viewerId)}:`);
    for (const entry of Object.values(byRoomId.value)) entry.requestGeneration++;
    byRoomId.value = {};
    viewerId = next;
    authGeneration = generation;
  }

  function guard(roomId: string, entry: RoomMembershipEntry): () => boolean {
    const viewer = viewerId;
    const generation = authGeneration;
    return () =>
      viewer !== null && viewerId === viewer && authGeneration === generation && byRoomId.value[roomId] === entry;
  }

  /** The entry is returned through the store, so the changes made to it reach components. */
  function getRoomMembership(roomId: string): RoomMembershipEntry {
    const known = byRoomId.value[roomId];
    if (known) return known;
    const created = (viewerId && readCache(viewerId, roomId)) || emptyEntry();
    byRoomId.value = { ...byRoomId.value, [roomId]: created };
    // Read back through the store: the reactive entry is the one whose changes components see.
    return byRoomId.value[roomId] ?? created;
  }

  async function loadRoomMembership(
    roomId: string,
    { append = false, query = '' }: { append?: boolean; query?: string } = {}
  ): Promise<void> {
    if (!viewerId) return;
    const viewer = viewerId;
    const entry = getRoomMembership(roomId);
    const request = ++entry.requestGeneration;
    const sameViewer = guard(roomId, entry);
    const current = () => sameViewer() && entry.requestGeneration === request;
    entry.loading = true;
    entry.error = '';
    try {
      const envelope = await fetchRoomMemberships(roomId, {
        cursor: append && query === entry.query ? entry.nextCursor : undefined,
        query
      });
      if (!current()) return;
      entry.members = mergeMembers(append && query === entry.query ? entry.members : [], envelope.members);
      entry.query = query;
      if (!query) entry.cachedMembers = entry.members;
      entry.nextCursor = envelope.pageInfo.nextCursor;
      entry.hasMore = envelope.pageInfo.hasMore;
      entry.presenceRevision = envelope.presenceRevision;
      entry.loaded = true;
      persist(viewer, roomId, entry);
    } catch (error) {
      if (!current()) return;
      const transient = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      if (!transient) {
        entry.cachedMembers = [];
        entry.members = [];
        entry.hasMore = false;
        entry.nextCursor = undefined;
        entry.presenceRevision = 0;
        entry.loaded = false;
        removeStorage(cacheKey(viewer, roomId));
      }
      entry.setError(() =>
        error instanceof Error ? currentErrorMessage(error) : t('Не удалось загрузить участников')
      );
      if (transient && !query && entry.cachedMembers.length > 0) entry.members = entry.cachedMembers;
    } finally {
      if (current()) entry.loading = false;
    }
  }

  function clearRoomMembership(roomId: string): void {
    const entry = byRoomId.value[roomId];
    if (entry) entry.requestGeneration++;
    const { [roomId]: _removed, ...remaining } = byRoomId.value;
    byRoomId.value = remaining;
    if (viewerId) removeStorage(cacheKey(viewerId, roomId));
  }

  async function leaveActiveRoomMembership(roomId: string): Promise<boolean> {
    if (!viewerId) return false;
    const entry = getRoomMembership(roomId);
    const current = guard(roomId, entry);
    const result = await leaveRoomMembership(roomId);
    if (!current()) return false;
    clearRoomMembership(roomId);
    return result.left;
  }

  /** Everyone who belongs to the room, online or not; `fallback` stands in until the roster has loaded. */
  function roomMemberTotal(roomId: string, fallback = 0): number {
    const entry = byRoomId.value[roomId];
    return entry?.cachedMembers.length ? entry.cachedMembers.length : fallback;
  }

  /** Fetch the roster once for a view that only needs its size. */
  function ensureRoomMembership(roomId: string): void {
    const entry = getRoomMembership(roomId);
    if (!entry.loaded && !entry.loading) void loadRoomMembership(roomId);
  }

  return {
    byRoomId,
    resetViewer,
    clearRoomMembership,
    getRoomMembership,
    loadRoomMembership,
    leaveActiveRoomMembership,
    roomMemberTotal,
    ensureRoomMembership
  };
});
