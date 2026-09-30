import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VISIBLE_ROOM_PEERS,
  TYPING_ACTIVITIES,
  TYPING_NOTICE_INTERVAL_MS,
  TYPING_NOTICE_TTL_MS,
  normalizeTypingActivity,
  parseClientEnvelope,
  buildServerEnvelope,
  toRoomPeerSummary,
  buildRoomRealtimeSummary,
  validateClientCommand
} from '../src/realtime.ts';

test('typing notices name a room or a user and carry nothing the server trusts', () => {
  assert.ok(TYPING_NOTICE_TTL_MS > TYPING_NOTICE_INTERVAL_MS, 'a repeated notice arrives before the last one expires');

  assert.equal(validateClientCommand({ type: 'room.chat.typing', payload: { roomId: 'abcdefghij' } }).ok, true);
  assert.deepEqual(validateClientCommand({ type: 'room.chat.typing', payload: {} }), {
    ok: false,
    code: 'invalid_room_id'
  });

  const userId = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(validateClientCommand({ type: 'dm.typing', payload: { userId } }).ok, true);
  for (const bad of [undefined, '', 'bob', 42, `${userId}x`]) {
    assert.deepEqual(validateClientCommand({ type: 'dm.typing', payload: { userId: bad } }), {
      ok: false,
      code: 'invalid_user_id'
    });
  }
});

test('a typing notice says whether the person types or picks an emoji, and means typing when it does not say', () => {
  assert.deepEqual([...TYPING_ACTIVITIES], ['typing', 'emoji']);
  assert.equal(normalizeTypingActivity(undefined), 'typing');
  assert.equal(normalizeTypingActivity(null), 'typing');
  assert.equal(normalizeTypingActivity('emoji'), 'emoji');
  for (const bad of ['', 'Emoji', 'recording', 1, {}]) assert.equal(normalizeTypingActivity(bad), null);

  const userId = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(
    validateClientCommand({ type: 'room.chat.typing', payload: { roomId: 'abcdefghij', activity: 'emoji' } }).ok,
    true
  );
  assert.equal(validateClientCommand({ type: 'dm.typing', payload: { userId, activity: 'typing' } }).ok, true);
  assert.deepEqual(
    validateClientCommand({ type: 'room.chat.typing', payload: { roomId: 'abcdefghij', activity: 'recording' } }),
    { ok: false, code: 'invalid_typing_activity' }
  );
  assert.deepEqual(validateClientCommand({ type: 'dm.typing', payload: { userId, activity: 42 } }), {
    ok: false,
    code: 'invalid_typing_activity'
  });
});

test('parseClientEnvelope accepts valid envelopes', () => {
  const result = parseClientEnvelope(JSON.stringify({ type: 'ping', payload: { at: 1 } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.envelope.type, 'ping');
  assert.equal(result.envelope.payload.at, 1);
});

test('parseClientEnvelope rejects malformed input', () => {
  assert.equal(parseClientEnvelope('').ok, false);
  assert.equal(parseClientEnvelope('{').ok, false);
  assert.equal(parseClientEnvelope(JSON.stringify({ payload: {} })).ok, false);
});

test('buildRoomRealtimeSummary caps visible peers and sets hiddenPeerCount', () => {
  const peers = Array.from({ length: 8 }, (_, index) => ({
    id: `peer-${index}`,
    name: `User ${index}`,
    muted: false,
    avatarAccent: '#123456',
    avatarColorKey: 'blue',
    avatarUrl: `/api/avatars/av_${index}_deadbeef.webp`
  }));

  const summary = buildRoomRealtimeSummary(
    {
      id: 'room1',
      name: 'Lobby',
      isStatic: true,
      relationship: 'owner',
      avatarUrl: '/api/avatars/room_room1_deadbeef.webp'
    },
    peers
  );

  assert.equal(summary.peers, 8);
  assert.equal(summary.visiblePeers.length, MAX_VISIBLE_ROOM_PEERS);
  assert.equal(summary.hiddenPeerCount, 3);
  assert.equal(summary.name, 'Lobby');
  assert.equal(summary.avatarUrl, '/api/avatars/room_room1_deadbeef.webp');
  assert.equal(summary.visiblePeers[0]!.avatarAccent, '#123456');
  assert.equal(summary.visiblePeers[0]!.avatarUrl, '/api/avatars/av_0_deadbeef.webp');
  assert.equal('emoji' in summary, false);
});

test('realtime avatar fields remain nullable for legacy summaries', () => {
  const peer = toRoomPeerSummary({ id: 'peer-1', name: 'Guest', muted: false });
  const summary = buildRoomRealtimeSummary({ id: 'room1' }, [peer]);

  assert.equal(peer.avatarAccent, null);
  assert.equal(peer.avatarUrl, null);
  assert.equal(summary.avatarUrl, null);
  assert.equal(summary.visiblePeers[0]!.avatarAccent, null);
  assert.equal(summary.visiblePeers[0]!.avatarUrl, null);
});

test('validateClientCommand enforces ping payload', () => {
  assert.equal(validateClientCommand({ type: 'ping', payload: { at: Date.now() } }).ok, true);
  assert.equal(validateClientCommand({ type: 'ping', payload: {} }).ok, false);
  assert.equal(validateClientCommand({ type: 'unknown', payload: {} }).ok, false);
});

test('buildServerEnvelope preserves optional id', () => {
  const frame = buildServerEnvelope('ready', { userId: 'u1' }, 'req-1');
  assert.equal(frame.type, 'ready');
  assert.equal(frame.id, 'req-1');
  assert.equal(frame.payload.userId, 'u1');
});
