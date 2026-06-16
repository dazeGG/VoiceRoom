'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanDisplayName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  cleanRoomName,
  cleanRoomEmoji,
  cleanAvatarColorKey,
  cleanRoomIconKey,
  cleanRoomColorKey,
  cleanRoomPresetKey,
  getRoomPreset,
  isValidPassword,
  normalizeLogin,
  AVATAR_COLOR_KEYS,
  ROOM_COLOR_KEYS,
  ROOM_EMOJIS,
  ROOM_ICON_KEYS,
  ROOM_PRESET_KEYS,
  ROOM_PRESETS
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
  assert.equal(cleanScreenProfileId('balanced-30'), 'balanced-30');
  assert.equal(cleanScreenProfileId('high'), 'high');
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

test('cleanRoomEmoji only allows the fixed palette', () => {
  for (const emoji of ROOM_EMOJIS) {
    assert.equal(cleanRoomEmoji(emoji), emoji);
  }
  assert.equal(cleanRoomEmoji('🦄'), '');
  assert.equal(cleanRoomEmoji('not-an-emoji'), '');
  assert.equal(cleanRoomEmoji(''), '');
  assert.equal(cleanRoomEmoji(123), '');
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

test('room visual keys validate icon and color independently', () => {
  for (const key of ROOM_ICON_KEYS) {
    assert.equal(cleanRoomIconKey(key), key);
  }
  for (const key of ROOM_COLOR_KEYS) {
    assert.equal(cleanRoomColorKey(key), key);
  }

  assert.equal(cleanRoomIconKey('headphones'), 'headphones');
  assert.equal(cleanRoomIconKey('🎧'), '');
  assert.equal(cleanRoomIconKey('custom-icon'), '');
  assert.equal(cleanRoomIconKey(' headphones '), '');
  assert.equal(cleanRoomColorKey('blue'), 'blue');
  assert.equal(cleanRoomColorKey('oklch(48% 0.18 278)'), '');
  assert.equal(cleanRoomColorKey('purple'), '');
  assert.equal(cleanRoomColorKey(undefined), '');
});

test('room presets are valid curated emoji plus independent keys', () => {
  assert.equal(ROOM_PRESETS.length, ROOM_PRESET_KEYS.length);
  assert.equal(new Set(ROOM_PRESET_KEYS).size, ROOM_PRESET_KEYS.length);

  for (const preset of ROOM_PRESETS) {
    assert.equal(cleanRoomPresetKey(preset.key), preset.key);
    assert.equal(cleanRoomIconKey(preset.iconKey), preset.iconKey);
    assert.equal(cleanRoomColorKey(preset.colorKey), preset.colorKey);
    assert.equal(typeof preset.emoji, 'string');
    assert.ok(preset.emoji.length > 0);
    assert.deepEqual(getRoomPreset(preset.key), preset);
  }

  assert.equal(cleanRoomPresetKey(''), '');
  assert.equal(cleanRoomPresetKey('voice'), '');
  assert.equal(cleanRoomPresetKey(' voice-blue '), '');
  assert.equal(cleanRoomPresetKey(123), '');
  assert.equal(getRoomPreset('missing'), null);
});

test('legacy room emoji palette remains the original seven presets', () => {
  assert.deepEqual(ROOM_EMOJIS, ['🎧', '📌', '🌙', '☀️', '🎮', '🎙️', '🔥']);
  assert.deepEqual(
    ROOM_PRESETS.slice(0, 7).map((preset) => preset.emoji),
    ROOM_EMOJIS
  );
});
