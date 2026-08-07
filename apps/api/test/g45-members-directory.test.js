'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMemberDirectoryService, presenceForUser } = require('../src/domains/membership/member-directory-service');

test('G45-A01 directory is membership-gated, cursor-bound to room/query and dedupes presence connections', async () => {
  const calls = [];
  const codec = {
    decode(cursor, options) { calls.push(['decode', cursor, options]); return { createdAtMicros: '1', id: 'a' }; },
    encode(value) { calls.push(['encode', value]); return 'next'; }
  };
  const service = createMemberDirectoryService({
    membershipService: { async canAccessDirectory() { return true; } },
    repository: { async listDirectoryPage(input) { calls.push(['list', input]); return { members: [{ userId: 'u', cursorTuple: { createdAtMicros: '2', id: 'u' } }], hasMore: true }; } },
    cursorCodec: codec,
    getPresenceSnapshot: async () => ({ revision: 7, byUserId: { u: [{ status: 'offline' }, { status: 'dnd', inVoice: true }] } })
  });
  const result = await service.list({ roomId: 'room', viewerUserId: 'viewer', cursor: 'cursor', query: 'Al' });
  assert.equal(result.status, 'ok');
  assert.equal(result.envelope.pageInfo.nextCursor, 'next');
  assert.equal(result.envelope.presenceRevision, 7);
  assert.deepEqual(result.envelope.members[0], { userId: 'u', displayName: '', login: '', avatarColorKey: '', avatarUrl: null, avatarAccent: null, role: 'member', joinedAt: null, inVoice: true, presenceStatus: 'dnd' });
  assert.equal(calls[0][2].context, 'room\nAl');
});

test('G45-A02 non-members cannot enumerate and empty presence is offline', async () => {
  const service = createMemberDirectoryService({
    membershipService: { async canAccessDirectory() { return false; } },
    repository: { async listDirectoryPage() { throw new Error('must not query'); } },
    cursorCodec: {}
  });
  assert.deepEqual(await service.list({ roomId: 'room', viewerUserId: 'outsider' }), { status: 'forbidden' });
  assert.deepEqual(presenceForUser(null, 'u'), { inVoice: false, presenceStatus: 'offline' });
});
