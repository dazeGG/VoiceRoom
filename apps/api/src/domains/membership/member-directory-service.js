'use strict';

const { buildMembershipEnvelope, normalizeMembershipRequest } = require('@voice-room/shared/membership');

const CURSOR_PURPOSE = 'room-members-directory';

function presenceForUser(snapshot, userId) {
  const raw = snapshot?.byUserId instanceof Map
    ? snapshot.byUserId.get(userId)
    : snapshot?.byUserId?.[userId];
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
  return { inVoice, presenceStatus };
}

function createMemberDirectoryService({ membershipService, repository, cursorCodec, getPresenceSnapshot = () => null } = {}) {
  if (!membershipService || !repository || !cursorCodec) {
    throw new TypeError('membershipService, repository and cursorCodec are required');
  }

  async function list({ roomId, viewerUserId, cursor, limit, query } = {}) {
    if (!roomId || !viewerUserId) return { status: 'unauthorized' };
    if (!await membershipService.canAccessDirectory(roomId, viewerUserId)) return { status: 'forbidden' };

    const request = normalizeMembershipRequest({ cursor, limit, query });
    const context = `${roomId}\n${request.query || ''}`;
    const after = request.cursor
      ? cursorCodec.decode(request.cursor, { purpose: CURSOR_PURPOSE, context })
      : null;
    const page = await repository.listDirectoryPage({
      roomId,
      query: request.query || '',
      limit: request.limit,
      after
    });
    const snapshot = await getPresenceSnapshot(roomId);
    const members = page.members.map((member) => ({ ...member, ...presenceForUser(snapshot, member.userId) }));
    const last = page.members.at(-1);
    const nextCursor = page.hasMore && last
      ? cursorCodec.encode({ purpose: CURSOR_PURPOSE, context, tuple: last.cursorTuple })
      : undefined;
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

module.exports = { CURSOR_PURPOSE, createMemberDirectoryService, presenceForUser };
