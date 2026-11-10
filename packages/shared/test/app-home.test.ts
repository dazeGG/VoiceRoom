import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_HOME, START_ROOM_HREF, START_ROOM_QUERY, extractRoomId, roomHref } from '../src/app-home.ts';

test('the site asks for a room at the app start with the start query', () => {
  assert.equal(START_ROOM_HREF, '/app?start=room');
  const url = new URL(START_ROOM_HREF, 'https://voiceroom.ru');
  assert.equal(url.pathname, APP_HOME);
  assert.equal(url.searchParams.get('start'), START_ROOM_QUERY.start);
});

test('a room id comes from a link, a route or a bare code, and nothing else', () => {
  const origin = 'https://voiceroom.ru';
  assert.equal(extractRoomId('https://voiceroom.ru/r/abc-123', origin), 'abc-123');
  assert.equal(extractRoomId('  voiceroom.ru/r/abc_123/ ', origin), 'abc_123');
  assert.equal(extractRoomId('/r/friday', origin), 'friday');
  assert.equal(extractRoomId('#friday', origin), 'friday');
  assert.equal(extractRoomId('friday', origin), 'friday');
  assert.equal(extractRoomId('', origin), '');
  assert.equal(extractRoomId('ab', origin), '');
  assert.equal(extractRoomId('код-комнаты', origin), '');
  assert.equal(extractRoomId('https://voiceroom.ru/download', origin), '');
});

test('a room address is its id under /r/', () => {
  assert.equal(roomHref('abc-123'), '/r/abc-123');
});
