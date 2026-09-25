import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMemberDirectoryService,
  presenceForUser,
  type DirectoryCursorCodec
} from '../src/domains/membership/member-directory-service.ts';
import { fake } from './fakes/index.ts';

test('G45-A01 directory is membership-gated, cursor-bound to room/query and dedupes presence connections', async () => {
  const calls: unknown[][] = [];
  const decodedWith: Array<{ purpose: string; context: string }> = [];
  const codec: DirectoryCursorCodec = {
    decode(cursor, options) {
      decodedWith.push(options);
      calls.push(['decode', cursor, options]);
      return { createdAtMicros: '1', id: 'a' };
    },
    encode(value) {
      calls.push(['encode', value]);
      return 'next';
    }
  };
  const service = createMemberDirectoryService({
    membershipService: {
      async canAccessDirectory() {
        return true;
      }
    },
    repository: {
      async listDirectoryPage(input) {
        calls.push(['list', input]);
        const member = {
          userId: 'u',
          displayName: 'Ann',
          login: 'ann',
          avatarColorKey: 'blue',
          avatarUrl: null,
          avatarAccent: null,
          role: 'member' as const,
          joinedAt: null,
          cursorTuple: { createdAtMicros: '2', id: 'u' }
        };
        return { members: [member], hasMore: true };
      }
    },
    cursorCodec: codec,
    getPresenceSnapshot: async () => ({
      revision: 7,
      byUserId: { u: [{ status: 'offline' }, { status: 'dnd', inVoice: true }] }
    })
  });
  const result = await service.list({ roomId: 'room', viewerUserId: 'viewer', cursor: 'cursor', query: 'Al' });
  assert.ok(result.status === 'ok');
  assert.equal(result.envelope.pageInfo.nextCursor, 'next');
  assert.equal(result.envelope.presenceRevision, 7);
  assert.deepEqual(result.envelope.members[0], {
    userId: 'u',
    displayName: 'Ann',
    login: 'ann',
    avatarColorKey: 'blue',
    avatarUrl: null,
    avatarAccent: null,
    role: 'member',
    joinedAt: null,
    inVoice: true,
    presenceStatus: 'dnd'
  });
  assert.equal(decodedWith[0]?.context, 'room\nAl');
});

test('G45-A02 non-members cannot enumerate and empty presence is offline', async () => {
  const service = createMemberDirectoryService({
    membershipService: {
      async canAccessDirectory() {
        return false;
      }
    },
    repository: {
      async listDirectoryPage() {
        throw new Error('must not query');
      }
    },
    cursorCodec: fake<DirectoryCursorCodec>()
  });
  assert.deepEqual(await service.list({ roomId: 'room', viewerUserId: 'outsider' }), { status: 'forbidden' });
  assert.deepEqual(presenceForUser(null, 'u'), { inVoice: false, presenceStatus: 'offline' });
});
