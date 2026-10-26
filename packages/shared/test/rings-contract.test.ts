import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { RingCreateBody, RingAnswer, RingRespondBody } from '../src/contracts/rings.ts';
import { buildNativePushData, nativePushChannel, parseNativePushData } from '../src/native-push.ts';

test('Ring contracts validate new-only HTTP states and idempotency keys', () => {
  assert.equal(Value.Check(RingCreateBody, { roomId: 'team', userId: 'u2', clientRequestId: 'bad' }), false);
  assert.equal(
    Value.Check(RingCreateBody, {
      roomId: 'team',
      userId: 'u2',
      clientRequestId: 'a3f9bdb7-2264-499a-928d-75e26606a817'
    }),
    true
  );
  assert.equal(Value.Check(RingRespondBody, { action: 'cancel' }), false);
  assert.equal(
    Value.Check(RingAnswer, {
      ok: true,
      ring: {
        id: 'r',
        callerUserId: 'a',
        recipientUserId: 'b',
        roomId: 'team',
        inviteMessageId: 'm',
        state: 'pending',
        revision: 1,
        createdAt: 1,
        expiresAt: 2,
        endedAt: null
      }
    }),
    true
  );
});

test('Ring terminal pushes remain data-only and preserve identity and revision', () => {
  assert.equal(nativePushChannel('ring.state'), null);
  const data = buildNativePushData(
    { type: 'ring.state', url: '', dedupeKey: 'ring:r:2:b' },
    { ringId: 'r', recipientUserId: 'b', ringRevision: '2', ringState: 'cancelled' }
  );
  assert.equal(data.ringId, 'r');
  assert.equal(data.recipientUserId, 'b');
  assert.equal(data.ringRevision, '2');
  assert.equal(data.ringState, 'cancelled');
  assert.deepEqual(parseNativePushData(data), data);
});

import { parseNativePushData as parseOldPush, isRingLive as isOldRingLive } from './fixtures/native-push-fa84ce81.ts';
test('supported old native parser does not mistake terminal data for a new ring', () => {
  const data = buildNativePushData(
    { type: 'ring.state', url: '', dedupeKey: 'ring:r:2:b' },
    { ringId: 'r', recipientUserId: 'b', ringRevision: '2', ringState: 'cancelled' }
  );
  const old = parseOldPush(data);
  assert.ok(old);
  assert.equal(old.type, 'ring.state');
  assert.equal(isOldRingLive(old, Date.now()), false);
  assert.equal(Object.hasOwn(old, 'ringId'), false, 'new keys remain optional to the older parser');
});
