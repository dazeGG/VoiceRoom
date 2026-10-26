// The data map of a push to the Android app: the API builds it from the Web
// Push payload plus the context's extra keys, the app parses it back. Every
// value is a string, the type is derived the same way for every sender, and
// texts are cut so the push fits RuStore's size limit.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NATIVE_PUSH_CHANNELS,
  NATIVE_PUSH_DATA_VERSION,
  NATIVE_PUSH_TEXT_LIMITS,
  buildNativePushData,
  clipNativePushText,
  isRingLive,
  nativePushChannel,
  parseNativePushData,
  type NativePushData
} from '../src/native-push.ts';
import { buildProviderPayload } from '../src/notifications.ts';

const EXPIRES_AT = 1_800_000_030_000;
const GRIN = '\u{1F600}';

test('a direct message carries its peer and message next to the url and dedupe key', () => {
  const data = buildNativePushData(
    {
      type: 'dm.message',
      title: 'Аня',
      body: 'Привет',
      tag: 'dm:u-anna',
      dedupeKey: 'dm:m-1',
      url: '/?dm=u-anna'
    },
    { peerUserId: 'u-anna', messageId: 'm-1' }
  );
  assert.deepEqual(data, {
    v: '1',
    type: 'dm.message',
    url: '/?dm=u-anna',
    dedupeKey: 'dm:m-1',
    peerUserId: 'u-anna',
    messageId: 'm-1'
  });
  assert.equal(nativePushChannel(data.type), NATIVE_PUSH_CHANNELS.messages);
  assert.deepEqual(parseNativePushData(data), data);
});

test('an outbox mention has no type, so it reads as a notification without its revision', () => {
  const payload = buildProviderPayload({
    id: 'n-1',
    roomId: 'kitchen',
    sourceMessageId: 'm-9',
    actorUserId: 'u-anna',
    reasons: ['mention'],
    revision: 3,
    body: '@boris смотри'
  });
  assert.ok(payload);
  const data = buildNativePushData(payload);
  assert.deepEqual(data, {
    v: '1',
    type: 'notification',
    url: '/?room=kitchen&message=m-9',
    dedupeKey: 'n-1:3',
    notificationId: 'n-1'
  });
  assert.equal(Object.hasOwn(data, 'revision'), false);
  assert.equal(Object.hasOwn(data, 'contractVersion'), false);
  assert.deepEqual(parseNativePushData(data), data);
});

test('friend and account pushes keep their type and add no keys', () => {
  for (const type of ['friend.request', 'friend.accepted', 'account.login']) {
    const data = buildNativePushData({ type, title: 'VoiceRoom', body: 'Боря', dedupeKey: `${type}:1`, url: '/' });
    assert.deepEqual(data, { v: '1', type, url: '/', dedupeKey: `${type}:1` });
    assert.equal(nativePushChannel(type), 'messages');
    assert.deepEqual(parseNativePushData(data), data);
  }
});

test('a payload with neither a type nor a notification id is unknown, and an unknown type still parses', () => {
  assert.equal(buildNativePushData({ title: 'x', url: '/' }).type, 'unknown');
  assert.deepEqual(parseNativePushData({ v: '1', type: 'room.new', url: '/r/kitchen', dedupeKey: 'k' }), {
    v: '1',
    type: 'room.new',
    url: '/r/kitchen',
    dedupeKey: 'k'
  });
});

test('a ring is data-only: it carries its title, body, caller, room and expiry', () => {
  const data = buildNativePushData(
    {
      type: 'ring',
      title: 'Аня зовёт вас',
      body: 'Комната «Кухня»',
      tag: 'ring:u-anna:kitchen',
      dedupeKey: `ring:u-anna:kitchen:${EXPIRES_AT}`,
      url: '/r/kitchen',
      expiresAt: EXPIRES_AT
    },
    { fromUserId: 'u-anna', fromName: 'Аня', roomId: 'kitchen', roomName: 'Кухня', roomEmoji: '' }
  );
  assert.deepEqual(data, {
    v: '1',
    type: 'ring',
    url: '/r/kitchen',
    dedupeKey: `ring:u-anna:kitchen:${EXPIRES_AT}`,
    expiresAt: String(EXPIRES_AT),
    title: 'Аня зовёт вас',
    body: 'Комната «Кухня»',
    fromUserId: 'u-anna',
    fromName: 'Аня',
    roomId: 'kitchen',
    roomName: 'Кухня',
    roomEmoji: ''
  });
  assert.equal(nativePushChannel('ring'), null);
  assert.deepEqual(parseNativePushData(data), data);
  for (const value of Object.values(data)) assert.equal(typeof value, 'string');
});

test('a ring is live until its expiry, and nothing else is a live ring', () => {
  const ring = { type: 'ring', expiresAt: String(EXPIRES_AT) };
  assert.equal(isRingLive(ring, EXPIRES_AT - 1), true);
  assert.equal(isRingLive(ring, EXPIRES_AT), false);
  assert.equal(isRingLive({ type: 'ring' }, 0), false);
  assert.equal(isRingLive({ type: 'ring', expiresAt: 'soon' }, 0), false);
  assert.equal(isRingLive({ type: 'dm.message', expiresAt: String(EXPIRES_AT) }, 0), false);
});

test('titles, bodies and names are cut to their limits without splitting an emoji', () => {
  const data = buildNativePushData(
    { type: 'ring', title: 'T'.repeat(150), body: GRIN.repeat(300), dedupeKey: 'k', url: '/' },
    { fromName: 'Я'.repeat(80), roomName: 'К'.repeat(80), roomId: 'r'.repeat(80) }
  );
  assert.equal(data.title, 'T'.repeat(NATIVE_PUSH_TEXT_LIMITS.title));
  assert.equal(data.body, GRIN.repeat(NATIVE_PUSH_TEXT_LIMITS.body));
  assert.equal(data.fromName, 'Я'.repeat(NATIVE_PUSH_TEXT_LIMITS.name));
  assert.equal(data.roomName, 'К'.repeat(NATIVE_PUSH_TEXT_LIMITS.name));
  assert.equal(data.roomId, 'r'.repeat(80), 'ids are not names and stay whole');
  assert.equal(clipNativePushText('короткий', 100), 'короткий');
});

test('extra keys the contract does not name are dropped', () => {
  const data = buildNativePushData(
    { type: 'dm.message', url: '/', dedupeKey: 'k' },
    { type: 'ring', v: '9', note: 'x' }
  );
  assert.deepEqual(data, { v: NATIVE_PUSH_DATA_VERSION, type: 'dm.message', url: '/', dedupeKey: 'k' });
});

test('the parser refuses anything but a version-1 map with a type, and keeps only string values', () => {
  assert.equal(parseNativePushData(null), null);
  assert.equal(parseNativePushData('ring'), null);
  assert.equal(parseNativePushData({ type: 'ring' }), null);
  assert.equal(parseNativePushData({ v: '2', type: 'ring' }), null);
  assert.equal(parseNativePushData({ v: '1', type: '' }), null);
  assert.deepEqual(parseNativePushData({ v: '1', type: 'dm.message', peerUserId: 7, messageId: 'm-1' }), {
    v: '1',
    type: 'dm.message',
    url: '',
    dedupeKey: '',
    messageId: 'm-1'
  });
});

test('the data is a plain string map, as a push service takes it', () => {
  const data: NativePushData = buildNativePushData(
    { type: 'dm.message', url: '/', dedupeKey: 'k' },
    { messageId: 'm' }
  );
  const map: Readonly<Record<string, string>> = data;
  assert.equal(map.messageId, 'm');
});

test('only native-confirmed mentions capability separates mention/reply notifications', () => {
  assert.equal(nativePushChannel('notification'), 'messages');
  assert.equal(nativePushChannel('notification', []), 'messages');
  assert.equal(nativePushChannel('notification', ['messages']), 'messages');
  assert.equal(nativePushChannel('notification', ['mentions']), 'mentions');
  for (const type of ['dm.message', 'friend.request', 'unknown'])
    assert.equal(nativePushChannel(type, ['mentions']), 'messages');
  for (const type of ['ring', 'ring.state'])
    assert.equal(nativePushChannel(type, ['messages', 'mentions', 'calls']), null);
});
