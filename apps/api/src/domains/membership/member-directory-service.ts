import {
  buildMembershipEnvelope,
  normalizeMembershipRequest,
  type MembershipEnvelope
} from '@voice-room/shared/membership';
import type { DirectoryCursorTuple, MembershipRepository } from './membership-repository.ts';

const CURSOR_PURPOSE = 'room-members-directory';

type PresenceEntry =
  { inVoice?: boolean; voice?: boolean; roomId?: unknown; presenceStatus?: string; status?: string } | null | undefined;
type PresenceSnapshot =
  | {
      byUserId?: Map<string, PresenceEntry | PresenceEntry[]> | Record<string, PresenceEntry | PresenceEntry[]>;
      revision?: number;
      presenceRevision?: number;
    }
  | null
  | undefined;

export interface DirectoryCursorCodec {
  encode(input: { purpose: string; context: string; tuple: DirectoryCursorTuple }): string;
  decode(cursor: string, options: { purpose: string; context: string }): DirectoryCursorTuple;
}

export type DirectoryListing =
  { status: 'unauthorized' | 'forbidden' } | { status: 'ok'; envelope: MembershipEnvelope };

function presenceForUser(
  snapshot: PresenceSnapshot,
  userId: string
): { inVoice: boolean; presenceStatus: 'dnd' | 'online' | 'afk' | 'offline' } {
  const byUserId = snapshot?.byUserId;
  const raw =
    byUserId instanceof Map
      ? byUserId.get(userId)
      : (byUserId as Record<string, PresenceEntry | PresenceEntry[]> | undefined)?.[userId];
  if (!raw) return { inVoice: false, presenceStatus: 'offline' };
  const connections = Array.isArray(raw) ? raw : [raw];
  const inVoice = connections.some((entry) => entry?.inVoice === true || entry?.voice === true || entry?.roomId);
  const statuses = connections.map((entry) => entry?.presenceStatus || entry?.status);
  const presenceStatus = statuses.includes('dnd')
    ? 'dnd'
    : statuses.includes('online')
      ? 'online'
      : statuses.includes('afk')
        ? 'afk'
        : 'offline';
  return { inVoice: Boolean(inVoice), presenceStatus };
}

function createMemberDirectoryService({
  membershipService,
  repository,
  cursorCodec,
  getPresenceSnapshot = () => null
}: {
  membershipService?: { canAccessDirectory(roomId: string, userId: string): Promise<boolean> };
  repository?: Pick<MembershipRepository, 'listDirectoryPage'>;
  cursorCodec?: DirectoryCursorCodec;
  getPresenceSnapshot?: (roomId: string) => PresenceSnapshot | Promise<PresenceSnapshot>;
} = {}) {
  if (!membershipService || !repository || !cursorCodec) {
    throw new TypeError('membershipService, repository and cursorCodec are required');
  }
  const memberships = membershipService;
  const directory = repository;
  const codec = cursorCodec;

  async function list({
    roomId,
    viewerUserId,
    cursor,
    limit,
    query
  }: {
    roomId?: string;
    viewerUserId?: string;
    cursor?: unknown;
    limit?: unknown;
    query?: unknown;
  } = {}): Promise<DirectoryListing> {
    if (!roomId || !viewerUserId) return { status: 'unauthorized' };
    if (!(await memberships.canAccessDirectory(roomId, viewerUserId))) return { status: 'forbidden' };

    const request = normalizeMembershipRequest({ cursor, limit, query });
    const context = `${roomId}\n${request.query || ''}`;
    const after = request.cursor ? codec.decode(request.cursor, { purpose: CURSOR_PURPOSE, context }) : null;
    const page = await directory.listDirectoryPage({
      roomId,
      query: request.query || '',
      limit: request.limit,
      after
    });
    const snapshot = await getPresenceSnapshot(roomId);
    const members = page.members.map((member) => ({ ...member, ...presenceForUser(snapshot, member.userId) }));
    const last = page.members.at(-1);
    const nextCursor =
      page.hasMore && last ? codec.encode({ purpose: CURSOR_PURPOSE, context, tuple: last.cursorTuple }) : undefined;
    return {
      status: 'ok',
      envelope: buildMembershipEnvelope({
        roomId,
        members,
        nextCursor,
        hasMore: page.hasMore,
        presenceRevision: snapshot?.revision || snapshot?.presenceRevision || 0
      })
    };
  }

  return { list };
}

export type MemberDirectoryService = ReturnType<typeof createMemberDirectoryService>;

export { CURSOR_PURPOSE, createMemberDirectoryService, presenceForUser };
