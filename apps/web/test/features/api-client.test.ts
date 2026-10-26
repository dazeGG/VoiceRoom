import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

import { AccountFailure } from '@voice-room/shared/contracts/account';
import { Done, Ok } from '@voice-room/shared/contracts/http';
import { Type } from 'typebox';
import { ApiError, api, failureBody, orNull, request } from '../../src/lib/api/client.ts';
import { clearLogBuffer, readLogBuffer } from '../../src/lib/shared/log.ts';
import { stubFetch } from '../fixtures/fetch.ts';

const Counted = Ok({ n: Type.Number() });
const AnyBody = Type.Record(Type.String(), Type.Unknown());

test('a success body comes back as the route answered it, with the cookie and JSON headers sent', async () => {
  const { calls, fetchMock } = stubFetch({ 'POST /api/friends/requests': { status: 201, body: { ok: true, n: 1 } } });
  assert.deepEqual(await api.post('/api/friends/requests', Counted, { login: 'bob' }, { bodySchema: AnyBody }), {
    ok: true,
    n: 1
  });
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
  const error = await api.post('/api/auth/login', Done, {}, { bodySchema: AnyBody }).catch((cause: unknown) => cause);
  assert.ok(error instanceof ApiError);
  assert.equal(error.message, 'Аккаунт ожидает удаления');
  assert.equal(error.status, 403);
  assert.equal(error.code, 'account_deletion_pending');
  assert.equal(failureBody(error, AccountFailure)?.deletionScheduledFor, 9);
  assert.equal(error.retryAfterSeconds, null);

  const limited = await api
    .post('/api/friends/requests', Done, {}, { bodySchema: AnyBody })
    .catch((cause: unknown) => cause);
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
  await assert.rejects(api.post('/api/rooms', Done, {}, { bodySchema: AnyBody }), {
    message: 'Проверка создания комнаты истекла',
    code: 'pow_expired'
  });
  // A code this build does not know yet keeps the server's wording, and no code.
  await assert.rejects(api.post('/api/future', Done, {}, { bodySchema: AnyBody }), {
    message: 'Новая причина',
    code: ''
  });
});

test('a failure without a message, or a body that is not JSON, falls back to the caller text', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));
  await assert.rejects(api.get('/api/rooms/x', Done), { message: 'Сервер недоступен', status: 502 });
  await assert.rejects(request('GET', '/api/rooms/x', Done, { fallback: 'Не удалось загрузить комнату' }), {
    message: 'Не удалось загрузить комнату'
  });
  vi.stubGlobal('fetch', async () => new Response('not json', { status: 200 }));
  await assert.rejects(api.get('/api/rooms/x', Done), ApiError);
});

test('a success body that does not match the route contract is an invalid_response failure', async () => {
  stubFetch({
    'GET /api/count': { body: { ok: true, n: 'one' } },
    'GET /api/empty': { body: { ok: true } }
  });
  const error = await api.get('/api/count', Counted).catch((cause: unknown) => cause);
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'invalid_response');
  assert.equal(error.status, 200);
  assert.equal(error.message, 'Сервер прислал непонятный ответ, обновите страницу');
  await assert.rejects(api.get('/api/empty', Counted), { code: 'invalid_response' });
  // Fields the contract does not name ride along untouched.
  stubFetch({ 'GET /api/count': { body: { ok: true, n: 2, later: 'field' } } });
  assert.deepEqual(await api.get('/api/count', Counted), { ok: true, n: 2, later: 'field' });
});

test('FormData goes out as is, without a JSON content type', async () => {
  const { fetchMock } = stubFetch({ 'POST /api/auth/avatar': { body: { ok: true } } });
  const form = new FormData();
  form.append('avatar', new Blob(['x']), 'avatar.webp');
  await api.post('/api/auth/avatar', Done, form);
  const init = fetchMock.mock.calls[0]?.[1];
  assert.equal(init?.body, form);
  assert.deepEqual(init?.headers, { Accept: 'application/json' });
});

test('a DELETE sends a body only when there is one', async () => {
  const { fetchMock } = stubFetch({ 'DELETE /api/blocks/u': { body: { ok: true } } });
  await api.delete('/api/blocks/u', Done);
  assert.equal(fetchMock.mock.calls[0]?.[1]?.body, undefined);
  await api.delete('/api/blocks/u', Done, { reason: 'x' }, { bodySchema: AnyBody });
  assert.equal(fetchMock.mock.calls[1]?.[1]?.body, JSON.stringify({ reason: 'x' }));
});

test('orNull turns a 404 into null and lets every other failure through', async () => {
  stubFetch({ '/api/rooms/gone': { status: 404, body: { ok: false, error: 'Комната не найдена' } } });
  assert.equal(await orNull(api.get('/api/rooms/gone', Done)), null);
  stubFetch({ '/api/rooms/x': { status: 500, body: { ok: false, error: 'boom' } } });
  await assert.rejects(orNull(api.get('/api/rooms/x', Done)), { message: 'boom' });
});

test('a request the network refuses is an unavailable failure, and an abort stays an abort', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
  const error = await api.get('/api/rooms/x', Done).catch((cause: unknown) => cause);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 0);
  assert.equal(error.code, 'unavailable');
  assert.equal(error.message, 'Сервер недоступен');

  const aborted = new DOMException('The operation was aborted.', 'AbortError');
  vi.stubGlobal('fetch', async () => {
    throw aborted;
  });
  await assert.rejects(api.get('/api/rooms/x', Done), (cause: unknown) => cause === aborted);
});

test('a body outside its contract is logged and still sent, for the server to refuse', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  clearLogBuffer();
  const { calls } = stubFetch({ 'POST /api/auth/login': { body: { ok: true } } });
  // The length rule is one the static type cannot carry.
  const Credentials = Type.Object({ login: Type.String({ minLength: 3 }) });
  await api.post('/api/auth/login', Done, { login: 'bob' }, { bodySchema: Credentials });
  assert.deepEqual(readLogBuffer(), []);
  await api.post('/api/auth/login', Done, { login: 'b' }, { bodySchema: Credentials });
  assert.deepEqual(calls.at(-1)?.body, { login: 'b' });
  assert.deepEqual(
    readLogBuffer().map((entry) => [entry.msg, entry.ctx?.url]),
    [['request body outside the contract', '/api/auth/login']]
  );
});

test('a JSON body needs its contract, while a body-less call and a FormData upload do not', () => {
  // Compile-time only: the calls sit in a function that never runs.
  const compileOnly = async () => {
    // @ts-expect-error a JSON body without bodySchema does not compile
    await api.post('/x', Done, { a: 1 });
    await api.post('/x', Done);
    await api.post('/x', Done, new FormData());
    await api.post('/x', Done, { a: 1 }, { bodySchema: Type.Object({ a: Type.Number() }) });
    // @ts-expect-error the body must match its bodySchema
    await api.post('/x', Done, { a: 'no' }, { bodySchema: Type.Object({ a: Type.Number() }) });
  };
  assert.equal(typeof compileOnly, 'function');
});
