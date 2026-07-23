import { browser } from '$app/environment';
import { fetchRoomMemberships, leaveRoomMembership, type MembershipMember } from '$lib/api/memberships';
import type { RoomPeer } from '$lib/api/rooms';

interface RoomMembershipEntry {
  cachedMembers: MembershipMember[];
  members: MembershipMember[];
  query: string;
  nextCursor?: string;
  hasMore: boolean;
  presenceRevision: number;
  loaded: boolean;
  loading: boolean;
  error: string;
}

const CACHE_PREFIX = 'voice-room:membership:v1:';

export const roomMembershipState = $state<{ byRoomId: Record<string, RoomMembershipEntry> }>({ byRoomId: {} });

function emptyEntry(): RoomMembershipEntry {
  return {
    cachedMembers: [],
    members: [],
    query: '',
    hasMore: false,
    presenceRevision: 0,
    loaded: false,
    loading: false,
    error: ''
  };
}

function cacheKey(roomId: string): string {
  return `${CACHE_PREFIX}${roomId}`;
}

function readCache(roomId: string): RoomMembershipEntry | null {
  if (!browser) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(roomId)) || 'null') as Partial<RoomMembershipEntry> | null;
    if (!parsed || !Array.isArray(parsed.members)) return null;
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
  if (!browser) return;
  try {
    localStorage.setItem(cacheKey(roomId), JSON.stringify({
      members: entry.cachedMembers,
      presenceRevision: entry.presenceRevision
    }));
  } catch {
    // Storage is an offline optimization; privacy mode/quota must not break roster loading.
  }
}

export function getRoomMembership(roomId: string): RoomMembershipEntry {
  let entry = roomMembershipState.byRoomId[roomId];
  if (!entry) {
    entry = readCache(roomId) || emptyEntry();
    roomMembershipState.byRoomId = { ...roomMembershipState.byRoomId, [roomId]: entry };
  }
  return entry;
}

function mergeMembers(current: MembershipMember[], incoming: MembershipMember[]): MembershipMember[] {
  const byUserId = new Map(current.map((member) => [member.userId, member]));
  for (const member of incoming) byUserId.set(member.userId, { ...byUserId.get(member.userId), ...member });
  return [...byUserId.values()].sort(
    (left, right) => Number(right.presenceStatus !== 'offline') - Number(left.presenceStatus !== 'offline')
  );
}

export async function loadRoomMembership(
  roomId: string,
  { append = false, query = '' }: { append?: boolean; query?: string } = {}
): Promise<void> {
  const entry = getRoomMembership(roomId);
  if (entry.loading) return;
  entry.loading = true;
  entry.error = '';
  try {
    const envelope = await fetchRoomMemberships(roomId, {
      cursor: append && query === entry.query ? entry.nextCursor : undefined,
      query
    });
    entry.members = mergeMembers(append && query === entry.query ? entry.members : [], envelope.members);
    entry.query = query;
    if (!query) entry.cachedMembers = entry.members;
    entry.nextCursor = envelope.pageInfo.nextCursor;
    entry.hasMore = envelope.pageInfo.hasMore;
    entry.presenceRevision = envelope.presenceRevision;
    entry.loaded = true;
    persist(roomId, entry);
  } catch (error) {
    entry.error = error instanceof Error ? error.message : 'Не удалось загрузить участников';
    if (!query && entry.cachedMembers.length > 0) entry.members = entry.cachedMembers;
  } finally {
    entry.loading = false;
  }
}

export function applyRoomVoicePeers(roomId: string, peers: RoomPeer[], presenceRevision: number): void {
  const entry = getRoomMembership(roomId);
  if (presenceRevision <= entry.presenceRevision) return;
  if (entry.presenceRevision > 0 && presenceRevision > entry.presenceRevision + 1) {
    void loadRoomMembership(roomId, { query: entry.query });
    return;
  }
  const voiceUserIds = new Set(
    peers.map((peer) => peer.accountUserId).filter((userId): userId is string => Boolean(userId))
  );
  const updateVoice = (members: MembershipMember[]) => mergeMembers([], members.map((member) => ({
    ...member,
    inVoice: voiceUserIds.has(member.userId)
  })));
  entry.members = updateVoice(entry.members);
  entry.cachedMembers = updateVoice(entry.cachedMembers);
  entry.presenceRevision = presenceRevision;
  persist(roomId, entry);
}

export function clearRoomMembership(roomId: string): void {
  const { [roomId]: _removed, ...remaining } = roomMembershipState.byRoomId;
  roomMembershipState.byRoomId = remaining;
  if (browser) localStorage.removeItem(cacheKey(roomId));
}

export async function leaveActiveRoomMembership(roomId: string): Promise<boolean> {
  const result = await leaveRoomMembership(roomId);
  clearRoomMembership(roomId);
  return result.left;
}
