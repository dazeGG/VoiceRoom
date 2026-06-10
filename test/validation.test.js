'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl
} = require('../lib/validation');

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
