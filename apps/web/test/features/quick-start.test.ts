// A visitor can start a temporary room without an account: the create call
// goes to the public room API with a proof of work when the server asks.

import { expect, test } from 'vitest';
import { createRoom } from '../../src/lib/api/rooms.ts';
import { stubFetch } from '../fixtures/fetch.ts';

test('a temporary room is created without a proof when the server does not require one', async () => {
  const { calls } = stubFetch({
    '/api/pow-challenge': { body: { required: false } },
    'POST /api/rooms': { status: 201, body: { ok: true, roomId: 'tmp123' } }
  });
  await expect(createRoom({ isStatic: false })).resolves.toBe('tmp123');
  expect(calls.at(-1)).toEqual({ method: 'POST', url: '/api/rooms', body: { isStatic: false, name: '', proof: null } });
  expect(calls.some((call) => call.url.startsWith('/api/auth'))).toBe(false);
});

test('a required proof of work is solved and sent with the create call', async () => {
  const { calls } = stubFetch({
    '/api/pow-challenge': { body: { required: true, challenge: 'abc', difficulty: 4, expiresAt: Date.now() + 60_000 } },
    'POST /api/rooms': { status: 201, body: { ok: true, roomId: 'tmp456' } }
  });
  await expect(createRoom()).resolves.toBe('tmp456');
  const body = calls.at(-1)?.body as { proof: { challenge: string; nonce: number } };
  expect(body.proof.challenge).toBe('abc');
  expect(Number.isInteger(body.proof.nonce)).toBe(true);
});

test('a refused create call surfaces the server message', async () => {
  stubFetch({
    '/api/pow-challenge': { body: { required: false } },
    'POST /api/rooms': { status: 429, body: { ok: false, error: 'Too many rooms created, try again later' } }
  });
  await expect(createRoom()).rejects.toThrow('Too many rooms created, try again later');
});
