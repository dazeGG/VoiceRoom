// A visitor can start a temporary room without an account: the create call
// goes to the public room API with a proof of work when the server asks.

import { expect, test } from 'vitest';
import { createRoom } from '../../src/lib/api/rooms.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { CreateRoomBody } from '@voice-room/shared/contracts/rooms';
import { defined, parse } from '../helpers/assert.ts';

test('a temporary room is created without a proof when the server does not require one', async () => {
  const { calls } = stubFetch({
    '/api/pow-challenge': { body: { ok: true, required: false } },
    'POST /api/rooms': {
      status: 201,
      body: {
        ok: true,
        roomId: 'tmp123',
        name: '',
        avatarUrl: null,
        createdAt: 1,
        isStatic: false,
        maxRooms: 10,
        maxRoomPeers: 25,
        owned: false
      }
    }
  });
  await expect(createRoom({ isStatic: false })).resolves.toBe('tmp123');
  expect(calls.at(-1)).toEqual({ method: 'POST', url: '/api/rooms', body: { isStatic: false, name: '', proof: null } });
  expect(calls.some((call) => call.url.startsWith('/api/auth'))).toBe(false);
});

test('a required proof of work is solved and sent with the create call', async () => {
  const { calls } = stubFetch({
    '/api/pow-challenge': {
      body: {
        ok: true,
        required: true,
        algorithm: 'sha256',
        challenge: 'abc',
        difficulty: 4,
        expiresAt: Date.now() + 60_000
      }
    },
    'POST /api/rooms': {
      status: 201,
      body: {
        ok: true,
        roomId: 'tmp456',
        name: '',
        avatarUrl: null,
        createdAt: 1,
        isStatic: false,
        maxRooms: 10,
        maxRoomPeers: 25,
        owned: false
      }
    }
  });
  await expect(createRoom()).resolves.toBe('tmp456');
  const proof = defined(parse(CreateRoomBody, calls.at(-1)?.body).proof, 'proof of work');
  expect(proof.challenge).toBe('abc');
  expect(Number.isInteger(proof.nonce)).toBe(true);
});

test('a refused create call surfaces the server message', async () => {
  stubFetch({
    '/api/pow-challenge': { body: { ok: true, required: false } },
    'POST /api/rooms': { status: 429, body: { ok: false, error: 'Too many rooms created, try again later' } }
  });
  await expect(createRoom()).rejects.toThrow('Too many rooms created, try again later');
});
