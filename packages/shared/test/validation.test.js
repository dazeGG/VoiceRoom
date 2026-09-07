'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRoomId,
  normalizePeerId,
  isReservedPeerId,
  RESERVED_PEER_ID_PREFIXES,
  normalizeSessionToken,
  cleanName,
  cleanDisplayName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  cleanRoomName,
  cleanAvatarColorKey,
  cleanPresenceStatus,
  isValidPassword,
  normalizeLogin,
  AVATAR_COLOR_KEYS,
  PRESENCE_STATUSES
} = require('../src/validation');

test('normalizeRoomId accepts valid ids and trims', () => {
  assert.equal(normalizeRoomId('abc'), 'abc');
  assert.equal(normalizeRoomId('  x7m2kq9p  '), 'x7m2kq9p');
  assert.equal(normalizeRoomId('a'.repeat(48)), 'a'.repeat(48));
});

test('normalizeRoomId rejects bad input', () => {
  assert.equal(normalizeRoomId('ab'), '');
  assert.equal(normalizeRoomId('a'.repeat(49)), '');
  assert.equal(normalizeRoomId('has space'), '');
  assert.equal(normalizeRoomId('bad/slash'), '');
  assert.equal(normalizeRoomId(123), '');
  assert.equal(normalizeRoomId(null), '');
});

test('normalizePeerId enforces 8-80 length', () => {
  assert.equal(normalizePeerId('12345678'), '12345678');
  assert.equal(normalizePeerId('1234567'), '');
  assert.equal(normalizePeerId('a'.repeat(81)), '');
  assert.equal(normalizePeerId('peer.dot'), '');
});

test('normalizePeerId rejects reserved system identities', () => {
  // The exact attack string: the music bot's LiveKit identity matched the peer-id
  // character class, so any client could claim it and be treated as the bot.
  assert.equal(normalizePeerId('music-bot-general'), '');
  assert.equal(normalizePeerId('music-bot:general'), '');
  assert.equal(normalizePeerId('MUSIC-BOT-general'), '');
  assert.equal(normalizePeerId('Music-Bot_general'), '');
  assert.equal(normalizePeerId('  music-bot-general  '), '');
  assert.equal(normalizePeerId('music-botnnnn'), '');
  assert.equal(normalizePeerId('music-bot'), '');

  // Ordinary peer ids are untouched, including ones that merely mention music.
  assert.equal(normalizePeerId('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'), 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');
  assert.equal(normalizePeerId('auth-1234567890'), 'auth-1234567890');
  assert.equal(normalizePeerId('musicbot-fan'), 'musicbot-fan');
  assert.equal(normalizePeerId('my-music-bot-1'), 'my-music-bot-1');
  assert.equal(normalizePeerId('lqz3k9-music-bot'), 'lqz3k9-music-bot');
});

test('isReservedPeerId keeps the reserved namespace in one place', () => {
  assert.deepEqual(RESERVED_PEER_ID_PREFIXES, ['music-bot']);
  assert.equal(Object.isFrozen(RESERVED_PEER_ID_PREFIXES), true);
  for (const prefix of RESERVED_PEER_ID_PREFIXES) {
    assert.equal(prefix, prefix.toLowerCase());
    assert.equal(isReservedPeerId(prefix), true);
    assert.equal(isReservedPeerId(`${prefix.toUpperCase()}-room`), true);
  }
  assert.equal(isReservedPeerId('peer-12345678'), false);
  assert.equal(isReservedPeerId(null), false);
  assert.equal(isReservedPeerId(42), false);
});

test('normalizeSessionToken enforces 32-128 length', () => {
  assert.equal(normalizeSessionToken('a'.repeat(32)), 'a'.repeat(32));
  assert.equal(normalizeSessionToken('a'.repeat(31)), '');
  assert.equal(normalizeSessionToken('a'.repeat(129)), '');
});

test('cleanName defaults to Guest and collapses whitespace', () => {
  assert.equal(cleanName(''), 'Guest');
  assert.equal(cleanName('   '), 'Guest');
  assert.equal(cleanName(undefined), 'Guest');
  assert.equal(cleanName('  Иван   Петров '), 'Иван Петров');
});

test('cleanName truncates to 40 chars', () => {
  assert.equal(cleanName('x'.repeat(60)).length, 40);
});

test('cleanStreamId validates the pattern', () => {
  assert.equal(cleanStreamId('stream:1.2-3'), 'stream:1.2-3');
  assert.equal(cleanStreamId(''), '');
  assert.equal(cleanStreamId('has space'), '');
  assert.equal(cleanStreamId('x'.repeat(121)), '');
});

test('cleanScreenProfileId only allows known profiles', () => {
  assert.equal(cleanScreenProfileId('balanced-5'), 'balanced-5');
  assert.equal(cleanScreenProfileId('balanced-30'), 'balanced-30');
  assert.equal(cleanScreenProfileId('high-5'), 'high-5');
  assert.equal(cleanScreenProfileId('high'), 'high');
  assert.equal(cleanScreenProfileId('source-5'), 'source-5');
  assert.equal(cleanScreenProfileId('source-15'), 'source-15');
  assert.equal(cleanScreenProfileId('source-30'), 'source-30');
  assert.equal(cleanScreenProfileId('ultra-120'), '');
  assert.equal(cleanScreenProfileId(''), '');
});

test('cleanLiveKitUrl accepts ws/wss only', () => {
  assert.equal(cleanLiveKitUrl('wss://livekit.example.com'), 'wss://livekit.example.com');
  assert.equal(cleanLiveKitUrl('ws://127.0.0.1:7880'), 'ws://127.0.0.1:7880');
  assert.equal(cleanLiveKitUrl('https://example.com'), '');
  assert.equal(cleanLiveKitUrl('javascript:alert(1)'), '');
  assert.equal(cleanLiveKitUrl(''), '');
});

test('normalizeLogin lower-cases and validates the handle', () => {
  assert.equal(normalizeLogin('Vovosh'), 'vovosh');
  assert.equal(normalizeLogin('  ADA_lovelace.99-x '), 'ada_lovelace.99-x');
  assert.equal(normalizeLogin('ab'), '');
  assert.equal(normalizeLogin('has space'), '');
  assert.equal(normalizeLogin('emoji😀'), '');
  assert.equal(normalizeLogin('x'.repeat(33)), '');
  assert.equal(normalizeLogin(42), '');
});

test('cleanDisplayName collapses whitespace and allows empty', () => {
  assert.equal(cleanDisplayName('  Вова   Пупкин '), 'Вова Пупкин');
  assert.equal(cleanDisplayName(''), '');
  assert.equal(cleanDisplayName('   '), '');
  assert.equal(cleanDisplayName(undefined), '');
  assert.equal(cleanDisplayName('x'.repeat(60)).length, 40);
});

test('isValidPassword enforces length bounds', () => {
  assert.equal(isValidPassword('password123'), true);
  assert.equal(isValidPassword('short'), false);
  assert.equal(isValidPassword('x'.repeat(201)), false);
  assert.equal(isValidPassword(12345678), false);
});

test('cleanRoomName collapses whitespace, allows empty, truncates to 60', () => {
  assert.equal(cleanRoomName('  квартирник  '), 'квартирник');
  assert.equal(cleanRoomName('созвон   по   проекту'), 'созвон по проекту');
  assert.equal(cleanRoomName(''), '');
  assert.equal(cleanRoomName(undefined), '');
  assert.equal(cleanRoomName('x'.repeat(80)).length, 60);
});

test('avatar color keys are curated tokens only', () => {
  assert.deepEqual(AVATAR_COLOR_KEYS, [
    'blurple',
    'violet',
    'orchid',
    'magenta',
    'rose',
    'coral',
    'rust',
    'amber',
    'olive',
    'green',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'slate'
  ]);

  for (const key of AVATAR_COLOR_KEYS) {
    assert.equal(cleanAvatarColorKey(key), key);
  }

  assert.equal(cleanAvatarColorKey(''), '');
  assert.equal(cleanAvatarColorKey('red'), '');
  assert.equal(cleanAvatarColorKey('BLURPLE'), '');
  assert.equal(cleanAvatarColorKey(' blurple '), '');
  assert.equal(cleanAvatarColorKey(AVATAR_COLOR_KEYS[0].toUpperCase()), '');
  assert.equal(cleanAvatarColorKey(null), '');
});

test('presence statuses expose and accept only the canonical vocabulary', () => {
  assert.deepEqual(PRESENCE_STATUSES, ['online', 'away', 'dnd', 'offline']);
  for (const status of PRESENCE_STATUSES) assert.equal(cleanPresenceStatus(status), status);
  assert.equal(cleanPresenceStatus(''), '');
  assert.equal(cleanPresenceStatus('Online'), '');
  assert.equal(cleanPresenceStatus(' away '), '');
  assert.equal(cleanPresenceStatus(null), '');
});
