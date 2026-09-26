// What the app wires around its routes, driven over HTTP on fakes.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiRuntime } from '../src/app/api-runtime.ts';
import { normalizeGatePrincipal } from '../src/domains/admission/gate-credential.repository.ts';
import type { ReadinessReport } from '../src/platform/readiness.ts';
import { fake, userSession } from './fakes/index.ts';

const ENV = { ...process.env, LIVEKIT_GATE_SECRET: 'gate-secret-for-tests-0123456789abcdef' };

// Kept apart, a left room stayed on the account's room list.
test('leaving a room revokes the seat and takes the room off the account list', async (t) => {
  const events: string[] = [];
  const app = createApiRuntime({ env: ENV }).createApp({
    store: {
      normalizeGatePrincipal,
      async getLiveKitGatePrincipalEpoch() {
        return 0;
      },
      async createLiveKitGateCredential() {
        return null;
      },
      async verifyLiveKitGateCredential() {
        return null;
      },
      async revokeLiveKitGatePrincipal(input) {
        events.push(`revoked ${input?.principal?.principalId}`);
        return { status: 'revoked', epoch: 1 };
      },
      async removeRoomBookmarkForUser(userId, roomId) {
        events.push(`bookmark removed ${roomId} for ${userId}`);
      }
    },
    users: {
      async getSessionUser(token) {
        return token === 'member-token' ? userSession({ id: 'user-1' }) : null;
      }
    },
    membershipServicesOverride: {
      service: {
        async getMembership() {
          return null;
        },
        async leaveRoom(input) {
          events.push(`left ${input?.roomId}`);
          return { status: 'left' };
        }
      }
    },
    readinessProviderOverride: { getSnapshot: () => fake<ReadinessReport>({ features: { membership: true } }) }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/rooms/static-room/memberships/me',
    headers: { cookie: 'vr_session=member-token' }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { ok: true, left: true });
  assert.deepEqual(events, ['revoked user-1', 'left static-room', 'bookmark removed static-room for user-1']);
});
