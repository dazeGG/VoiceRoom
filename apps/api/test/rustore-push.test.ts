// The RuStore Push client: what it posts, how each answer maps to an outcome,
// and the shape and size of the message for a direct message, an outbox
// mention and a ring.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativePushData } from '@voice-room/shared/native-push';
import {
  RUSTORE_MESSAGE_MAX_BYTES,
  buildRuStoreMessage,
  createRuStorePushClient,
  type RuStoreMessage
} from '../src/lib/rustore-push.ts';

type Request = { url: string; init: RequestInit | undefined; body: string };

function answering(status: number, body?: unknown) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    // The client posts a string URL and a JSON string body.
    requests.push({
      url: typeof input === 'string' ? input : '',
      init,
      body: typeof init?.body === 'string' ? init.body : ''
    });
    return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
      status
    });
  };
  return { fetch, requests };
}

const rustoreError = (code: number, status: string, message = 'details') => ({ error: { code, message, status } });
const MESSAGE: RuStoreMessage = {
  token: 'phone-token',
  data: { v: '1', type: 'dm.message', url: '/', dedupeKey: 'k' }
};
const bytes = (message: RuStoreMessage | null) => Buffer.byteLength(JSON.stringify({ message }), 'utf8');

test('send posts the message to the project with the service token', async () => {
  const { fetch, requests } = answering(200, {});
  const client = createRuStorePushClient({ projectId: 'project-1', serviceToken: 'secret', fetch });

  const result = await client.send(MESSAGE);

  assert.deepEqual(result, { outcome: 'sent', httpStatus: 200, status: '', message: '' });
  const [request] = requests;
  assert.ok(request);
  assert.equal(request.url, 'https://vkpns.rustore.ru/v1/projects/project-1/messages:send');
  assert.equal(request.init?.method, 'POST');
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer secret');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(request.body), { message: MESSAGE });
});

test('every RuStore answer maps to its outcome', async () => {
  const cases: Array<[number, unknown, string]> = [
    [200, {}, 'sent'],
    [200, undefined, 'sent'],
    [404, rustoreError(404, 'NOT_FOUND'), 'expired_token'],
    [400, rustoreError(400, 'UNREGISTERED'), 'expired_token'],
    [404, rustoreError(404, 'UNREGISTERED'), 'expired_token'],
    [400, rustoreError(400, 'INVALID_ARGUMENT'), 'rejected'],
    [401, rustoreError(401, 'UNAUTHENTICATED'), 'unauthorized'],
    [403, rustoreError(403, 'PERMISSION_DENIED'), 'unauthorized'],
    [429, rustoreError(429, 'TOO_MANY_REQUESTS'), 'retryable'],
    [500, rustoreError(500, 'INTERNAL'), 'retryable'],
    [503, '<html>busy</html>', 'retryable'],
    // A 404 that is not RuStore's NOT_FOUND (a proxy page, a wrong path) keeps the token.
    [404, '<html>not found</html>', 'retryable'],
    [302, undefined, 'retryable']
  ];
  for (const [status, body, outcome] of cases) {
    const client = createRuStorePushClient({ projectId: 'p', serviceToken: 's', ...answering(status, body) });
    const result = await client.send(MESSAGE);
    assert.equal(result.outcome, outcome, `${status} ${JSON.stringify(body)}`);
    assert.equal(result.httpStatus, status);
  }
});

test('a refused message carries RuStore status and message, never anything unparsed', async () => {
  const rejected = await createRuStorePushClient({
    projectId: 'p',
    serviceToken: 's',
    ...answering(400, rustoreError(400, 'INVALID_ARGUMENT', 'x'.repeat(1000)))
  }).send(MESSAGE);
  assert.equal(rejected.status, 'INVALID_ARGUMENT');
  assert.equal(rejected.message.length, 300);

  const odd = await createRuStorePushClient({
    projectId: 'p',
    serviceToken: 's',
    ...answering(400, { error: { status: { nested: true }, message: ['list'] } })
  }).send(MESSAGE);
  assert.deepEqual([odd.outcome, odd.status, odd.message], ['rejected', '', '']);
});

test('a network error and a timeout are retryable', async () => {
  const offline = createRuStorePushClient({
    projectId: 'p',
    serviceToken: 's',
    fetch: async () => {
      throw new TypeError('fetch failed');
    }
  });
  assert.deepEqual(await offline.send(MESSAGE), {
    outcome: 'retryable',
    httpStatus: null,
    status: 'NETWORK_ERROR',
    message: 'fetch failed'
  });

  const hanging = createRuStorePushClient({
    projectId: 'p',
    serviceToken: 's',
    timeoutMs: 20,
    fetch: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
  });
  const startedAt = Date.now();
  const result = await hanging.send(MESSAGE);
  assert.deepEqual([result.outcome, result.httpStatus, result.status], ['retryable', null, 'TIMEOUT']);
  assert.ok(Date.now() - startedAt < 2000, 'the timeout ends the request');
});

test('a direct message is a notification on the messages channel with its data', () => {
  const message = buildRuStoreMessage({
    token: 'phone-token',
    payload: {
      type: 'dm.message',
      title: 'Ада',
      body: 'привет',
      tag: 'dm:ada',
      dedupeKey: 'dm:m1',
      url: '/?dm=ada'
    },
    nativeData: { peerUserId: 'ada', messageId: 'm1' },
    ttlSeconds: 3600
  });
  assert.deepEqual(message, {
    token: 'phone-token',
    data: { v: '1', type: 'dm.message', url: '/?dm=ada', dedupeKey: 'dm:m1', peerUserId: 'ada', messageId: 'm1' },
    notification: { title: 'Ада', body: 'привет' },
    android: { ttl: '3600s', notification: { channel_id: 'messages' } }
  });
  assert.deepEqual(parseNativePushData(message?.data), message?.data);

  const untimed = buildRuStoreMessage({ token: 't', payload: { type: 'friend.request', title: 'T', body: 'B' } });
  assert.deepEqual(untimed?.android, { notification: { channel_id: 'messages' } });
  const untitled = buildRuStoreMessage({ token: 't', payload: { type: 'friend.accepted' } });
  assert.deepEqual(untitled?.notification, { title: 'VoiceRoom', body: '' });
});

test('an outbox mention gets the notification type and no revision', () => {
  const message = buildRuStoreMessage({
    token: 't',
    payload: {
      notificationId: 'n1',
      revision: 3,
      dedupeKey: 'n1:3',
      title: 'Упоминание',
      body: 'текст',
      url: '/?room=r1&message=m1'
    },
    ttlSeconds: 3600
  });
  assert.equal(message?.data.type, 'notification');
  assert.equal(message?.data.notificationId, 'n1');
  assert.equal('revision' in (message?.data ?? {}), false);
  assert.equal(message?.android?.notification?.channel_id, 'messages');
});

test('a ring is data-only and lives as long as the ring', () => {
  const message = buildRuStoreMessage({
    token: 't',
    payload: {
      type: 'ring',
      title: 'Ада зовёт вас',
      body: 'Комната «Кухня»',
      tag: 'ring:ada:r1',
      dedupeKey: 'ring:ada:r1:21000',
      url: '/r/r1',
      expiresAt: 21000
    },
    nativeData: { fromUserId: 'ada', fromName: 'Ада', roomId: 'r1', roomName: 'Кухня', roomEmoji: '🍳' },
    ttlSeconds: 20
  });
  assert.deepEqual(message, {
    token: 't',
    data: {
      v: '1',
      type: 'ring',
      url: '/r/r1',
      dedupeKey: 'ring:ada:r1:21000',
      expiresAt: '21000',
      title: 'Ада зовёт вас',
      body: 'Комната «Кухня»',
      fromUserId: 'ada',
      fromName: 'Ада',
      roomId: 'r1',
      roomName: 'Кухня',
      roomEmoji: '🍳'
    },
    android: { ttl: '20s' }
  });
});

test('the worst case fits in 4096 bytes', () => {
  const token = 'x'.repeat(1024);
  const name = 'Ж'.repeat(200);
  const body = '😀'.repeat(1000);
  const ring = buildRuStoreMessage({
    token,
    payload: {
      type: 'ring',
      title: `${name} зовёт вас`,
      body,
      dedupeKey: `ring:${'u'.repeat(36)}:${'r'.repeat(36)}:1790000000000`,
      url: `/r/${'r'.repeat(36)}`,
      expiresAt: 1790000000000
    },
    nativeData: { fromUserId: 'u'.repeat(36), fromName: name, roomId: 'r'.repeat(36), roomName: name, roomEmoji: '🍳' },
    ttlSeconds: 30
  });
  const dm = buildRuStoreMessage({
    token,
    payload: {
      type: 'dm.message',
      title: name,
      body,
      dedupeKey: `dm:${'m'.repeat(36)}`,
      url: `/?dm=${'u'.repeat(36)}`
    },
    nativeData: { peerUserId: 'u'.repeat(36), messageId: 'm'.repeat(36) },
    ttlSeconds: 3600
  });
  for (const message of [ring, dm]) {
    assert.ok(message, 'the worst case is still sent');
    assert.equal(
      message.data.body ?? message.notification?.body,
      '😀'.repeat(240),
      'the body keeps its 240 characters'
    );
    assert.ok(bytes(message) <= RUSTORE_MESSAGE_MAX_BYTES, `${bytes(message)} bytes`);
  }
  assert.equal(ring?.data.fromName, 'Ж'.repeat(64));
});

test('an oversized message drops its body, and is not sent when even that does not fit', () => {
  const payload = { type: 'dm.message', title: 'T', body: '😀'.repeat(240), dedupeKey: 'k', url: '/' };
  const shortened = buildRuStoreMessage({ token: 'x'.repeat(3200), payload });
  assert.ok(shortened);
  assert.deepEqual(shortened.notification, { title: 'T' });
  assert.ok(bytes(shortened) <= RUSTORE_MESSAGE_MAX_BYTES);

  const ring = buildRuStoreMessage({ token: 'x'.repeat(3200), payload: { ...payload, type: 'ring' } });
  assert.ok(ring);
  assert.equal('body' in ring.data, false);
  assert.equal(ring.data.title, 'T');

  assert.equal(buildRuStoreMessage({ token: 'x'.repeat(4096), payload }), null);
});
