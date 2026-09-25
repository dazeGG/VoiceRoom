import test from 'node:test';
import assert from 'node:assert/strict';

import { createRoomStore } from '../src/lib/room-store.ts';
import fastify from 'fastify';
import type { Membership } from '../src/domains/membership/membership-repository.ts';
import { registerMembershipRoutes } from '../src/domains/membership/membership.routes.ts';
import type { ApiContext } from '../src/app/context.ts';
import type { LeaveOutcome } from '../src/domains/membership/membership-service.ts';
import { fake, fakePoolWithClient as createFakePool, result, storedUser, type ScopedCall } from './fakes/index.ts';

const STATIC_ROOM_ROW = {
  id: 'static-room',
  creator_ip: '',
  is_static: true,
  owner_id: 'owner-user',
  name: 'Room',
  created_at: new Date(1000),
  updated_at: new Date(1000),
  empty_since: null,
  deleted_at: null
};

function roomListHandler({ owner = false, banned = false } = {}) {
  return (text: string) => {
    if (/SELECT \* FROM rooms WHERE id = \$1 AND deleted_at IS NULL/.test(text)) {
      return result([STATIC_ROOM_ROW], 1);
    }
    if (/role = 'owner'/.test(text)) return { rows: owner ? [{ exists: 1 }] : [], rowCount: owner ? 1 : 0 };
    if (/FROM room_bans/.test(text)) {
      return banned
        ? {
            rows: [
              {
                id: 'ban',
                room_id: 'static-room',
                user_id: 'user-1',
                ip: '',
                created_at: new Date(1000),
                expires_at: null
              }
            ],
            rowCount: 1
          }
        : { rows: [], rowCount: 0 };
    }
    if (/DELETE FROM room_bookmarks/.test(text)) return result([{ id: 'bookmark' }], 1);
    return result([], 1);
  };
}

const indexOf = (calls: ScopedCall[], pattern: RegExp) => calls.findIndex((call) => pattern.test(call.text));

test('adding a room to the list makes the user a member inside the same transaction', async () => {
  const pool = createFakePool(roomListHandler());
  const store = createRoomStore({ pool });

  const result = await store.addRoomBookmarkForUser('user-1', 'static-room', 5000);

  assert.equal(result.status, 'bookmarked');
  const insert = pool.calls.find((call) => /INSERT INTO room_memberships/.test(call.text));
  assert.ok(insert, 'membership insert expected');
  assert.equal(insert.scope, 'client');
  assert.match(insert.text, /'member'/);
  assert.match(insert.text, /ON CONFLICT \(room_id, user_id\) DO NOTHING/);
  assert.deepEqual(insert.values.slice(1), ['static-room', 'user-1', new Date(5000)]);
  const banLookup = pool.calls[indexOf(pool.calls, /FROM room_bans/)];
  assert.ok(banLookup);
  assert.equal(banLookup.scope, 'client');
  assert.ok(indexOf(pool.calls, /INSERT INTO room_bookmarks/) < indexOf(pool.calls, /FROM room_bans/));
  assert.ok(indexOf(pool.calls, /FROM room_bans/) < indexOf(pool.calls, /INSERT INTO room_memberships/));
  assert.ok(indexOf(pool.calls, /INSERT INTO room_memberships/) < indexOf(pool.calls, /^COMMIT$/));
});

test('a user banned from the room keeps the list entry but does not become a member', async () => {
  const pool = createFakePool(roomListHandler({ banned: true }));
  const store = createRoomStore({ pool });

  const result = await store.addRoomBookmarkForUser('user-1', 'static-room', 5000);

  assert.equal(result.status, 'bookmarked');
  assert.ok(pool.calls.some((call) => /INSERT INTO room_bookmarks/.test(call.text)));
  assert.equal(indexOf(pool.calls, /INSERT INTO room_memberships/), -1);
});

test('the owner adding their own room gets no extra member row and no ban lookup', async () => {
  const pool = createFakePool(roomListHandler({ owner: true }));
  const store = createRoomStore({ pool });

  const result = await store.addRoomBookmarkForUser('owner-user', 'static-room', 5000);

  assert.equal(result.status, 'bookmarked');
  assert.equal(indexOf(pool.calls, /FROM room_bans/), -1);
  assert.equal(indexOf(pool.calls, /INSERT INTO room_memberships/), -1);
});

test('removing a room from the list also ends the non-owner membership', async () => {
  const pool = createFakePool(roomListHandler());
  const store = createRoomStore({ pool });

  const result = await store.removeRoomBookmarkForUser('user-1', 'static-room');

  assert.deepEqual(result, { removed: true, status: 'removed' });
  const membershipDelete = pool.calls.find((call) => /DELETE FROM room_memberships/.test(call.text));
  assert.ok(membershipDelete, 'membership delete expected');
  assert.equal(membershipDelete.scope, 'client');
  assert.match(membershipDelete.text, /role = 'member'/);
  assert.deepEqual(membershipDelete.values, ['static-room', 'user-1']);
});

test('owners cannot remove their room from the list and keep their membership', async () => {
  const pool = createFakePool(roomListHandler({ owner: true }));
  const store = createRoomStore({ pool });

  const result = await store.removeRoomBookmarkForUser('owner-user', 'static-room');

  assert.deepEqual(result, { removed: false, status: 'owner' });
  assert.equal(indexOf(pool.calls, /DELETE FROM/), -1);
});

type LeaveStatus = 'invalid' | 'not_active' | 'owner_required' | 'left';

function membershipRow(role: 'owner' | 'member'): Membership {
  return { id: 'm', roomId: 'static-room', userId: 'user-1', role, createdAt: null, updatedAt: null, metadata: {} };
}

// The DELETE route over real Fastify with a membership service that answers
// the given membership and leave outcome.
function leaveRoute({
  membership = membershipRow('member'),
  leaveStatus = 'left',
  prepared = true
}: { membership?: Membership | null; leaveStatus?: LeaveStatus; prepared?: boolean } = {}) {
  const app = fastify();
  const onLeftCalls: unknown[] = [];
  const ctx = fake<ApiContext>({ resolveSession: async () => ({ user: storedUser() }) });
  registerMembershipRoutes(app, ctx, {
    directory: fake(),
    memberships: {
      async getMembership() {
        return membership;
      },
      async leaveRoom() {
        return { status: leaveStatus, membership } as LeaveOutcome;
      }
    },
    enabled: () => true,
    prepareLeave: async () => prepared,
    onLeft: async ({ roomId, userId }) => {
      onLeftCalls.push({ roomId, userId });
    }
  });
  return {
    onLeftCalls,
    async call() {
      const response = await app.inject({ method: 'DELETE', url: '/api/rooms/static-room/memberships/me' });
      await app.close();
      return { statusCode: response.statusCode, payload: response.json<unknown>() };
    }
  };
}

test('leaving a room also takes it off the list, including a retry after the membership is gone', async () => {
  const left = leaveRoute();
  assert.deepEqual((await left.call()).payload, { ok: true, left: true });
  assert.deepEqual(left.onLeftCalls, [{ roomId: 'static-room', userId: 'user-1' }]);

  const retried = leaveRoute({ membership: null, leaveStatus: 'not_active' });
  assert.deepEqual((await retried.call()).payload, { ok: true, left: false });
  assert.deepEqual(retried.onLeftCalls, [{ roomId: 'static-room', userId: 'user-1' }]);
});

test('owners, failed leaves and refused disconnects keep the room on the list', async () => {
  const owner = leaveRoute({ membership: membershipRow('owner') });
  assert.equal((await owner.call()).statusCode, 409);

  const failed = leaveRoute({ leaveStatus: 'invalid' });
  assert.equal((await failed.call()).statusCode, 409);

  const refused = leaveRoute({ prepared: false });
  assert.equal((await refused.call()).statusCode, 503);

  assert.deepEqual([...owner.onLeftCalls, ...failed.onLeftCalls, ...refused.onLeftCalls], []);
});

test('the member directory answers its page, and refuses outsiders, bad cursors and a disabled feature', async (t) => {
  const page = {
    contractVersion: 1 as const,
    roomId: 'static-room',
    members: [
      {
        userId: 'user-1',
        displayName: 'Anna',
        login: 'anna',
        avatarColorKey: 'blurple',
        avatarUrl: null,
        avatarAccent: null,
        role: 'member' as const,
        joinedAt: 5,
        inVoice: false,
        presenceStatus: 'online' as const
      }
    ],
    pageInfo: { hasMore: false },
    presenceRevision: 3
  };
  const seen: unknown[] = [];
  function directoryApp({
    answer = 'ok',
    enabled = true,
    signedIn = true
  }: { answer?: 'ok' | 'forbidden' | 'unauthorized' | 'bad-cursor'; enabled?: boolean; signedIn?: boolean } = {}) {
    const app = fastify();
    t.after(() => app.close());
    registerMembershipRoutes(
      app,
      fake<ApiContext>({ resolveSession: async () => (signedIn ? { user: storedUser() } : null) }),
      {
        directory: {
          async list(input) {
            seen.push(input);
            if (answer === 'bad-cursor') throw Object.assign(new Error('bad cursor'), { code: 'invalid_cursor' });
            return answer === 'ok' ? { status: 'ok', envelope: page } : { status: answer };
          }
        },
        memberships: fake(),
        enabled: () => enabled,
        prepareLeave: async () => true,
        onLeft: async () => {}
      }
    );
    return (url = '/api/rooms/static-room/members?limit=20&q=an&cursor=c1') => app.inject({ method: 'GET', url });
  }

  const listed = await directoryApp()();
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), page);
  assert.deepEqual(seen[0], { roomId: 'static-room', viewerUserId: 'user-1', cursor: 'c1', limit: '20', query: 'an' });
  await directoryApp()('/api/rooms/static-room/members?query=old');
  assert.equal((seen[1] as { query?: string }).query, 'old');

  assert.equal((await directoryApp({ answer: 'forbidden' })()).statusCode, 403);
  assert.equal((await directoryApp({ answer: 'unauthorized' })()).statusCode, 401);
  assert.deepEqual((await directoryApp({ answer: 'bad-cursor' })()).json(), {
    ok: false,
    error: 'Invalid cursor',
    code: 'invalid_cursor'
  });
  assert.equal((await directoryApp({ signedIn: false })()).statusCode, 401);
  assert.equal((await directoryApp({ enabled: false })()).statusCode, 404);
});
