import test from 'node:test';
import assert from 'node:assert/strict';

import * as notifications from '../src/notifications.ts';

const ITEM = {
  id: 'n1',
  roomId: 'ytgpi7xpda',
  sourceMessageId: 'd55b6114-864c-448a-8b59-ae3854099f1f',
  actorUserId: 'u1',
  reasons: ['mention'],
  revision: 3,
  createdAt: 1,
  updatedAt: 1,
  readAt: null,
  retractedAt: null,
  body: '@daze hi'
};

test('a notification opens the room preview on its message, never the join route', () => {
  const route = notifications.notificationRoute(ITEM);

  // /r/:roomId means "put me back inside this room" and joins voice on load; a
  // mention must open the chat without doing that.
  assert.doesNotMatch(route, /^\/r\//);
  const url = new URL(route, 'https://voiceroom.test');
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('room'), ITEM.roomId);
  assert.equal(url.searchParams.get('message'), ITEM.sourceMessageId);
});

test('route values are encoded, so an id cannot inject another parameter', () => {
  const route = notifications.notificationRoute({ roomId: 'a&join=1', sourceMessageId: 'm?x=y' });
  const url = new URL(route, 'https://voiceroom.test');

  assert.equal(url.searchParams.get('room'), 'a&join=1');
  assert.equal(url.searchParams.get('message'), 'm?x=y');
  assert.equal(url.searchParams.get('join'), null);
});

test('push payloads carry the same route the in-app panel uses', async () => {
  const payload = notifications.buildProviderPayload(ITEM);

  assert.equal(payload.route, notifications.notificationRoute(ITEM));
});
