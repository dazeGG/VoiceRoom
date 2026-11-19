// The kind of a room travels in the admin answers only as an optional field, so
// an API a release behind still passes the admin app's checks; the widgets
// answer carries the state, the limits and today's numbers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { AdminWidgets, LiveRoom, RoomCall, RoomCallsQuery } from '../src/contracts/admin.ts';

const call = {
  id: 'c1',
  roomId: 'P8NZ4T',
  roomName: '',
  isStatic: false,
  startedAt: 1,
  endedAt: 2,
  stays: []
};

test('a call and a live room read with and without the kind of their room', () => {
  assert.equal(Value.Check(RoomCall, call), true);
  assert.equal(Value.Check(RoomCall, { ...call, kind: 'widget' }), true);
  assert.equal(Value.Check(RoomCall, { ...call, kind: 'main' }), true);
  assert.equal(Value.Check(RoomCall, { ...call, kind: 'embed' }), false);

  const room = { roomId: 'r', name: 'r', isStatic: false, avatarUrl: null, owner: null, since: null, peers: [] };
  assert.equal(Value.Check(LiveRoom, room), true);
  assert.equal(Value.Check(LiveRoom, { ...room, kind: 'widget' }), true);
  assert.equal(Value.Check(LiveRoom, { ...room, kind: 'other' }), false);
});

test('the call history may be narrowed to one kind of room', () => {
  assert.equal(Value.Check(RoomCallsQuery, { kind: 'widget' }), true);
  assert.equal(Value.Check(RoomCallsQuery, { kind: 'site' }), false);
});

test('the widgets answer holds the state, the limits and the day', () => {
  const answer = {
    ok: true,
    state: {
      admissionEnabled: true,
      boundaryRequired: true,
      flagEnabled: true,
      recoveryGeneration: 3,
      owners: [
        { role: 'api', claimed: true, acknowledgedGeneration: 3 },
        { role: 'gate', claimed: false, acknowledgedGeneration: null }
      ]
    },
    limits: { maxRoomPeers: 12, createRateLimit: 20, createRateWindowMs: 60000, powDifficulty: 14 },
    today: { calls: 7, guests: 12, distinctIpKeys: 9, voiceMinutes: 126 }
  };
  assert.equal(Value.Check(AdminWidgets, answer), true);
  assert.equal(
    Value.Check(AdminWidgets, {
      ...answer,
      state: { ...answer.state, owners: [{ role: 'worker', claimed: true, acknowledgedGeneration: null }] }
    }),
    false
  );
});
