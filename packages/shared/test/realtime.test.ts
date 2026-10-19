import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VISIBLE_ROOM_PEERS,
  TYPING_ACTIVITIES,
  TYPING_NOTICE_INTERVAL_MS,
  TYPING_NOTICE_TTL_MS,
  parseClientEnvelope,
  parseServerFrame,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  toRoomPeerSummary,
  buildRoomRealtimeSummary,
  validateClientCommand
} from '../src/realtime.ts';
import { defined } from './helpers/assert-defined.ts';

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
  const plain = validateClientCommand({ type: 'room.chat.typing', payload: { roomId: 'abcdefghij' } });
  assert.deepEqual(plain, { ok: true, envelope: { type: 'room.chat.typing', payload: { roomId: 'abcdefghij' } } });
  for (const bad of ['', 'Emoji', 'recording', 1, {}, null]) {
    assert.deepEqual(
      validateClientCommand({ type: 'room.chat.typing', payload: { roomId: 'abcdefghij', activity: bad } }),
      {
        ok: false,
        code: 'invalid_typing_activity'
      }
    );
  }

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

test('a media request names the voice session and whether it is a screen share or a camera', () => {
  const target = { roomId: 'abcdefghij', peerId: 'peer-0001', sessionToken: 't'.repeat(32) };
  assert.equal(validateClientCommand({ type: 'room.media.request', payload: { ...target, kind: 'screen' } }).ok, true);
  assert.equal(validateClientCommand({ type: 'room.media.request', payload: { ...target, kind: 'camera' } }).ok, true);
  assert.deepEqual(validateClientCommand({ type: 'room.media.request', payload: { ...target, kind: 'microphone' } }), {
    ok: false,
    code: 'invalid_media_kind'
  });
  assert.deepEqual(
    validateClientCommand({ type: 'room.media.request', payload: { roomId: 'abcdefghij', kind: 'screen' } }),
    {
      ok: false,
      code: 'invalid_peer_id'
    }
  );
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
  const firstPeer = defined(summary.visiblePeers[0], 'the first visible peer');
  assert.equal(firstPeer.avatarAccent, '#123456');
  assert.equal(firstPeer.avatarUrl, '/api/avatars/av_0_deadbeef.webp');
  assert.equal('emoji' in summary, false);
});

test('realtime avatar fields remain nullable for legacy summaries', () => {
  const peer = toRoomPeerSummary({ id: 'peer-1', name: 'Guest', muted: false });
  const summary = buildRoomRealtimeSummary({ id: 'room1' }, [peer]);

  assert.equal(peer.avatarAccent, null);
  assert.equal(peer.avatarUrl, null);
  assert.equal(summary.avatarUrl, null);
  const firstPeer = defined(summary.visiblePeers[0], 'the first visible peer');
  assert.equal(firstPeer.avatarAccent, null);
  assert.equal(firstPeer.avatarUrl, null);
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

test('a command comes back typed with only the fields its schema names', () => {
  const target = { roomId: 'abcdefghij', peerId: 'peer-0001', sessionToken: 't'.repeat(32) };
  const result = validateClientCommand({
    id: 'req-1',
    type: 'room.join',
    payload: { ...target, name: 'Аня', admin: true }
  });
  assert.deepEqual(result, {
    ok: true,
    envelope: { id: 'req-1', type: 'room.join', payload: { ...target, name: 'Аня' } }
  });
  if (!result.ok || result.envelope.type !== 'room.join') return;
  const name: string = result.envelope.payload.name;
  assert.equal(name, 'Аня');

  const update = validateClientCommand({
    type: 'room.peer.update',
    payload: { ...target, patch: { muted: true, viewedScreenPeerId: null, owner: true } }
  });
  assert.deepEqual(update, {
    ok: true,
    envelope: { type: 'room.peer.update', payload: { ...target, patch: { muted: true, viewedScreenPeerId: null } } }
  });
});

test('a malformed command is refused with the code of its first wrong field', () => {
  const target = { roomId: 'abcdefghij', peerId: 'peer-0001', sessionToken: 't'.repeat(32) };
  const refused = (type: string, payload: unknown) => validateClientCommand({ type, payload });

  assert.deepEqual(refused('ping', { at: '1' }), { ok: false, code: 'invalid_ping' });
  assert.deepEqual(refused('room.join', { ...target }), { ok: false, code: 'invalid_name' });
  assert.deepEqual(refused('room.join', { ...target, roomId: 'a b', sessionToken: 'short', name: 'x' }), {
    ok: false,
    code: 'invalid_room_id'
  });
  assert.deepEqual(refused('room.leave', { roomId: 'abcdefghij', peerId: 'peer-0001' }), {
    ok: false,
    code: 'invalid_session_token'
  });
  assert.deepEqual(refused('room.peer.update', { ...target, patch: { muted: 'yes' } }), {
    ok: false,
    code: 'invalid_payload'
  });
  assert.deepEqual(refused('room.peer.update', { ...target }), { ok: false, code: 'invalid_payload' });
  assert.deepEqual(validateClientCommand({ payload: {} }), { ok: false, code: 'invalid_envelope' });
  assert.deepEqual(refused('room.chat.send', {}), { ok: false, code: 'unknown_type' });
});

test('a frame from the server comes back typed only when it matches its event', () => {
  const peer = {
    accountUserId: '',
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    id: 'peer-0001',
    serverMuted: false
  };
  const joined = parseServerFrame({ type: 'room.peer.joined', payload: { roomId: 'abcdefghij', peer } });
  assert.equal(joined.ok, true);
  if (joined.ok && joined.frame.type === 'room.peer.joined') {
    const peerId: string = joined.frame.payload.peer.id;
    assert.equal(peerId, 'peer-0001');
  }

  // A refusal names the claimed type and the first field that did not match, for the log.
  assert.deepEqual(parseServerFrame({ type: 'room.peer.joined', payload: { roomId: 'abcdefghij' } }), {
    ok: false,
    type: 'room.peer.joined',
    reason: '/payload: must have required properties peer'
  });
  assert.deepEqual(
    parseServerFrame({ type: 'room.peer.left', payload: { roomId: 'r', peerId: 'p', reason: 'gone' } }),
    { ok: false, type: 'room.peer.left', reason: '/payload/reason: must be equal to constant' }
  );
  assert.deepEqual(parseServerFrame({ type: 'room.teleported', payload: {} }), {
    ok: false,
    type: 'room.teleported',
    reason: 'unknown event type'
  });
  assert.deepEqual(parseServerFrame('pong'), { ok: false, type: '', reason: 'not a frame' });
  assert.equal(parseServerFrame({ type: 'pong' }).ok, false);
});

test('an error frame passes with any code, so a refusal newer than the client still reaches it', () => {
  const frame = buildServerErrorEnvelope('superseded_join', 'Join replaced by a newer connection', 'req-2');
  assert.deepEqual(parseServerFrame(JSON.parse(JSON.stringify(frame))), { ok: true, frame });
  const newer = { type: 'error', error: { code: 'something_new', message: 'Unknown' } };
  assert.deepEqual(parseServerFrame(newer), { ok: true, frame: newer });
  assert.equal(parseServerFrame({ type: 'error', error: { code: 3 } }).ok, false);
});
