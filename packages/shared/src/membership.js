'use strict';

const MEMBERSHIP_CONTRACT_VERSION = 1;
const MEMBERSHIP_DEFAULT_LIMIT = 50;
const MEMBERSHIP_MAX_LIMIT = 100;
const MEMBERSHIP_ROLES = Object.freeze(['owner', 'member']);
const MEMBERSHIP_ROLE_SET = new Set(MEMBERSHIP_ROLES);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, max = 256) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= max ? normalized : '';
}

function normalizeMembershipLimit(value, fallback = MEMBERSHIP_DEFAULT_LIMIT) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, MEMBERSHIP_MAX_LIMIT);
}

function normalizeMembershipRequest(value = {}) {
  const cursor = cleanString(value.cursor, 4096);
  const query = cleanString(value.query ?? value.q, 80);
  return {
    contractVersion: MEMBERSHIP_CONTRACT_VERSION,
    cursor: cursor || undefined,
    limit: normalizeMembershipLimit(value.limit),
    query: query || undefined
  };
}

function normalizeMembershipMember(value) {
  if (!isObject(value)) return null;
  const userId = cleanString(value.userId ?? value.id, 36);
  if (!userId) return null;
  const role = MEMBERSHIP_ROLE_SET.has(value.role) ? value.role : 'member';
  const presenceStatus = ['online', 'afk', 'dnd', 'offline'].includes(value.presenceStatus)
    ? value.presenceStatus
    : 'offline';
  return {
    userId,
    displayName: cleanString(value.displayName, 120),
    login: cleanString(value.login, 120),
    avatarColorKey: cleanString(value.avatarColorKey, 40),
    avatarUrl: cleanString(value.avatarUrl, 1024) || null,
    avatarAccent: cleanString(value.avatarAccent, 40) || null,
    role,
    joinedAt: value.joinedAt != null && Number.isFinite(Number(value.joinedAt)) ? Number(value.joinedAt) : null,
    inVoice: Boolean(value.inVoice),
    presenceStatus
  };
}

function buildMembershipEnvelope({ roomId, members = [], nextCursor, hasMore = false, presenceRevision = 0 } = {}) {
  return {
    contractVersion: MEMBERSHIP_CONTRACT_VERSION,
    roomId: cleanString(roomId, 48),
    members: Array.isArray(members) ? members.map(normalizeMembershipMember).filter(Boolean) : [],
    pageInfo: {
      nextCursor: cleanString(nextCursor, 4096) || undefined,
      hasMore: Boolean(hasMore)
    },
    presenceRevision: Math.max(0, Number.isSafeInteger(Number(presenceRevision)) ? Number(presenceRevision) : 0)
  };
}

function normalizeMembershipEnvelope(value) {
  if (!isObject(value) || value.contractVersion !== MEMBERSHIP_CONTRACT_VERSION) {
    return { ok: false, code: 'invalid_membership_envelope' };
  }
  const envelope = buildMembershipEnvelope({
    roomId: value.roomId,
    members: value.members,
    nextCursor: value.pageInfo?.nextCursor,
    hasMore: value.pageInfo?.hasMore,
    presenceRevision: value.presenceRevision
  });
  if (!envelope.roomId) return { ok: false, code: 'invalid_membership_envelope' };
  return { ok: true, envelope };
}

module.exports = {
  MEMBERSHIP_CONTRACT_VERSION,
  MEMBERSHIP_DEFAULT_LIMIT,
  MEMBERSHIP_MAX_LIMIT,
  MEMBERSHIP_ROLES,
  buildMembershipEnvelope,
  normalizeMembershipEnvelope,
  normalizeMembershipLimit,
  normalizeMembershipMember,
  normalizeMembershipRequest
};
