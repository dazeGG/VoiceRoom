import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { MembershipMember } from '@voice-room/shared/contracts/membership';
import { fetchRoomMemberships, leaveRoomMembership } from '@/api/memberships';
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
}

const CACHE_PREFIX = 'voice-room:membership:v1:';
/** What persist() writes; a revision that does not read as a number counts as none. */
const CachedMembership = Type.Object({
  members: Type.Array(MembershipMember),
  presenceRevision: Type.Optional(Type.Unknown())
});

function emptyEntry(): RoomMembershipEntry {
  return {
    cachedMembers: [],
    members: [],
    query: '',
    hasMore: false,
    presenceRevision: 0,
    loaded: false,
    loading: false,
    requestGeneration: 0,
    error: ''
  };
}

function cacheKey(roomId: string): string {
  return `${CACHE_PREFIX}${roomId}`;
}

function readCache(roomId: string): RoomMembershipEntry | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(roomId)) || 'null');
    if (!Value.Check(CachedMembership, parsed)) return null;
    return {
      ...emptyEntry(),
      cachedMembers: parsed.members,
      members: parsed.members,
      presenceRevision: Number(parsed.presenceRevision) || 0,
      loaded: true
    };
  } catch {
    return null;
  }
}

function persist(roomId: string, entry: RoomMembershipEntry): void {
  try {
    localStorage.setItem(
      cacheKey(roomId),
      JSON.stringify({
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
  const byRoomId = ref<Record<string, RoomMembershipEntry>>({});

  /** The entry is returned through the store, so the changes made to it reach components. */
  function getRoomMembership(roomId: string): RoomMembershipEntry {
    const known = byRoomId.value[roomId];
    if (known) return known;
    const created = readCache(roomId) || emptyEntry();
    byRoomId.value = { ...byRoomId.value, [roomId]: created };
    // Read back through the store: the reactive entry is the one whose changes components see.
    return byRoomId.value[roomId] ?? created;
  }

  async function loadRoomMembership(
    roomId: string,
    { append = false, query = '' }: { append?: boolean; query?: string } = {}
  ): Promise<void> {
    const entry = getRoomMembership(roomId);
    const requestGeneration = ++entry.requestGeneration;
    entry.loading = true;
    entry.error = '';
    try {
      const envelope = await fetchRoomMemberships(roomId, {
        cursor: append && query === entry.query ? entry.nextCursor : undefined,
        query
      });
      if (requestGeneration !== entry.requestGeneration) return;
      entry.members = mergeMembers(append && query === entry.query ? entry.members : [], envelope.members);
      entry.query = query;
      if (!query) entry.cachedMembers = entry.members;
      entry.nextCursor = envelope.pageInfo.nextCursor;
      entry.hasMore = envelope.pageInfo.hasMore;
      entry.presenceRevision = envelope.presenceRevision;
      entry.loaded = true;
      persist(roomId, entry);
    } catch (error) {
      if (requestGeneration !== entry.requestGeneration) return;
      entry.error = error instanceof Error ? error.message : 'Не удалось загрузить участников';
      if (!query && entry.cachedMembers.length > 0) entry.members = entry.cachedMembers;
    } finally {
      if (requestGeneration === entry.requestGeneration) entry.loading = false;
    }
  }

  function clearRoomMembership(roomId: string): void {
    const { [roomId]: _removed, ...remaining } = byRoomId.value;
    byRoomId.value = remaining;
    removeStorage(cacheKey(roomId));
  }

  async function leaveActiveRoomMembership(roomId: string): Promise<boolean> {
    const result = await leaveRoomMembership(roomId);
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
    getRoomMembership,
    loadRoomMembership,
    leaveActiveRoomMembership,
    roomMemberTotal,
    ensureRoomMembership
  };
});
