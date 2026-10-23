import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUuid,
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanDisplayName,
  cleanGuestName,
  isReservedName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  cleanRoomName,
  cleanAvatarColorKey,
  cleanPresenceStatus,
  isValidPassword,
  normalizeLogin,
  AVATAR_COLOR_KEYS
} from '../src/validation.ts';
import { defined } from './helpers/assert-defined.ts';

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
  assert.equal(cleanScreenProfileId('balanced-5'), 'balanced-5');
  assert.equal(cleanScreenProfileId('balanced-30'), 'balanced-30');
  assert.equal(cleanScreenProfileId('high-60'), 'high-60');
  assert.equal(cleanScreenProfileId('source-60'), 'source-60');
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
  assert.equal(cleanAvatarColorKey(defined(AVATAR_COLOR_KEYS[0], 'the first color key').toUpperCase()), '');
  assert.equal(cleanAvatarColorKey(null), '');
});

test('presence statuses accept only the canonical vocabulary', () => {
  for (const status of ['online', 'away', 'dnd', 'offline']) assert.equal(cleanPresenceStatus(status), status);
  assert.equal(cleanPresenceStatus(''), '');
  assert.equal(cleanPresenceStatus('Online'), '');
  assert.equal(cleanPresenceStatus(' away '), '');
  assert.equal(cleanPresenceStatus(null), '');
});

test('isReservedName catches the service name however it is spelled', () => {
  for (const name of [
    'VoiceRoom',
    'voiceroom',
    'Voice Room',
    'voice_room_support',
    'Администрация VoiceRoom',
    'V0iceR00m',
    'VоiсeRооm', // Cyrillic о and с
    'Vóice Róom',
    'Войс Рум',
    'войсрум',
    'Воисрум'
  ]) {
    assert.equal(isReservedName(name), true, name);
  }
  for (const name of ['', 'Voice', 'Room', 'Vova', 'voicemail room', 'Войска', 'Рустам', 'alice']) {
    assert.equal(isReservedName(name), false, name);
  }
  assert.equal(isReservedName(null), false);
});

test('cleanGuestName turns a guest posing as the service into Guest', () => {
  assert.equal(cleanGuestName('  Voice   Room '), 'Guest');
  assert.equal(cleanGuestName('Маша'), 'Маша');
  assert.equal(cleanGuestName(''), 'Guest');
});

test('isUuid accepts the canonical form in either case and nothing else', () => {
  assert.equal(isUuid('123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(isUuid('123E4567-E89B-12D3-A456-426614174000'), true);
  assert.equal(isUuid('123e4567e89b12d3a456426614174000'), false);
  assert.equal(isUuid(' 123e4567-e89b-12d3-a456-426614174000'), false);
  assert.equal(isUuid(42), false);
});
