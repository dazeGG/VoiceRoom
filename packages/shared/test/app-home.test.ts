import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_HOME, START_ROOM_HREF, START_ROOM_QUERY } from '../src/app-home.ts';

test('the site asks for a room at the app start with the start query', () => {
  assert.equal(START_ROOM_HREF, '/app?start=room');
  const url = new URL(START_ROOM_HREF, 'https://voiceroom.ru');
  assert.equal(url.pathname, APP_HOME);
  assert.equal(url.searchParams.get('start'), START_ROOM_QUERY.start);
});
