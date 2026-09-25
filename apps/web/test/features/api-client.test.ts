import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

import { ApiError, api, orNull, request } from '../../src/lib/api/client.ts';
import { stubFetch } from '../fixtures/fetch.ts';

test('a success body comes back as the route answered it, with the cookie and JSON headers sent', async () => {
  const { calls, fetchMock } = stubFetch({ 'POST /api/friends/requests': { status: 201, body: { ok: true, n: 1 } } });
  assert.deepEqual(await api.post('/api/friends/requests', { login: 'bob' }), { ok: true, n: 1 });
  assert.deepEqual(calls, [{ method: 'POST', url: '/api/friends/requests', body: { login: 'bob' } }]);
  const init = fetchMock.mock.calls[0]?.[1];
  assert.equal(init?.credentials, 'same-origin');
  assert.deepEqual(init?.headers, { Accept: 'application/json', 'Content-Type': 'application/json' });
});

test('a failure carries the status, code and extra fields the server sent', async () => {
  stubFetch({
    'POST /api/auth/login': {
      status: 403,
      body: { ok: false, error: 'Аккаунт ожидает удаления', code: 'account_deletion_pending', deletionScheduledFor: 9 }
    },
    'POST /api/friends/requests': { status: 429, body: { ok: false, error: 'Слишком много', retryAfterSeconds: 6 } }
  });
  const error = await api.post('/api/auth/login', {}).catch((cause: unknown) => cause);
  assert.ok(error instanceof ApiError);
  assert.equal(error.message, 'Аккаунт ожидает удаления');
  assert.equal(error.status, 403);
  assert.equal(error.code, 'account_deletion_pending');
  assert.equal(error.details.deletionScheduledFor, 9);
  assert.equal(error.retryAfterSeconds, null);

  const limited = await api.post('/api/friends/requests', {}).catch((cause: unknown) => cause);
  assert.ok(limited instanceof ApiError);
  assert.equal(limited.code, '');
  assert.equal(limited.retryAfterSeconds, 6);
});

test('the user reads the text the web keeps for the code, whatever the server wrote', async () => {
  stubFetch({
    'POST /api/rooms': {
      status: 403,
      body: { ok: false, error: 'Room creation proof expired', code: 'pow_expired' }
    },
    'POST /api/future': { status: 409, body: { ok: false, error: 'Новая причина', code: 'added_in_a_later_server' } }
  });
  await assert.rejects(api.post('/api/rooms', {}), {
    message: 'Проверка создания комнаты истекла',
    code: 'pow_expired'
  });
  // A code this build does not know yet keeps the server's wording.
  await assert.rejects(api.post('/api/future', {}), { message: 'Новая причина', code: 'added_in_a_later_server' });
});

test('a failure without a message, or a body that is not JSON, falls back to the caller text', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));
  await assert.rejects(api.get('/api/rooms/x'), { message: 'Сервер недоступен', status: 502 });
  await assert.rejects(request('GET', '/api/rooms/x', { fallback: 'Не удалось загрузить комнату' }), {
    message: 'Не удалось загрузить комнату'
  });
  vi.stubGlobal('fetch', async () => new Response('not json', { status: 200 }));
  await assert.rejects(api.get('/api/rooms/x'), ApiError);
});

test('FormData goes out as is, without a JSON content type', async () => {
  const { fetchMock } = stubFetch({ 'POST /api/auth/avatar': { body: { ok: true } } });
  const form = new FormData();
  form.append('avatar', new Blob(['x']), 'avatar.webp');
  await api.post('/api/auth/avatar', form);
  const init = fetchMock.mock.calls[0]?.[1];
  assert.equal(init?.body, form);
  assert.deepEqual(init?.headers, { Accept: 'application/json' });
});

test('a DELETE sends a body only when there is one', async () => {
  const { fetchMock } = stubFetch({ 'DELETE /api/blocks/u': { body: { ok: true } } });
  await api.delete('/api/blocks/u');
  assert.equal(fetchMock.mock.calls[0]?.[1]?.body, undefined);
  await api.delete('/api/blocks/u', { reason: 'x' });
  assert.equal(fetchMock.mock.calls[1]?.[1]?.body, JSON.stringify({ reason: 'x' }));
});

test('orNull turns a 404 into null and lets every other failure through', async () => {
  stubFetch({ '/api/rooms/gone': { status: 404, body: { ok: false, error: 'Комната не найдена' } } });
  assert.equal(await orNull(api.get('/api/rooms/gone')), null);
  stubFetch({ '/api/rooms/x': { status: 500, body: { ok: false, error: 'boom' } } });
  await assert.rejects(orNull(api.get('/api/rooms/x')), { message: 'boom' });
});
