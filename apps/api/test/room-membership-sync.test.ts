import test from 'node:test';
import assert from 'node:assert/strict';

import fastify from 'fastify';
import type { Membership } from '../src/domains/membership/membership.repository.ts';
import { registerMembershipRoutes } from '../src/domains/membership/membership.routes.ts';
import type { ApiContext } from '../src/app/context.ts';
import type { LeaveOutcome } from '../src/domains/membership/membership.service.ts';
import { fake, storedUser } from './fakes/index.ts';

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
