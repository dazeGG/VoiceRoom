// The room client's API calls: LiveKit credentials come with every address to
// try, refusals keep what the recovery logic keys on, and a room check fills
// the top bar.

import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../src/lib/api/client.ts';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { checkRoomExists, requestLiveKitToken } from '../../src/lib/features/room/client/net/api.ts';
import { resetRuntimeConfig } from '../../src/lib/platform/runtime-config.ts';
import { stubFetch } from '../fixtures/fetch.ts';

const JOIN = { name: 'Аня', peerId: 'peer0001', roomId: 'room-a', sessionToken: 'token' };
const ADMISSION = {
  ok: true,
  gateCredentialId: 'cred-1',
  room: 'lk-room',
  token: 'jwt',
  ttlSeconds: 60,
  url: 'wss://lk.example/rtc'
};

beforeEach(() => resetRuntimeConfig());

test('credentials carry every LiveKit address to try', async () => {
  const { calls } = stubFetch({
    'POST /api/livekit-token': { body: ADMISSION }
  });
  const credentials = await requestLiveKitToken(JOIN);
  expect(credentials).toMatchObject({ token: 'jwt', url: ADMISSION.url });
  expect(credentials.urls).toEqual(['wss://lk.example/']);
  expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/livekit-token', body: JOIN });
});

test('a refused token request carries the text for its code, the room and the HTTP status', async () => {
  stubFetch({
    'POST /api/livekit-token': {
      status: 403,
      body: { ok: false, error: 'Вы заблокированы', code: 'room_banned', roomId: 'room-a' }
    }
  });
  const error: unknown = await requestLiveKitToken(JOIN).then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ message: 'Вы заблокированы в этой комнате', code: 'room_banned', status: 403 });
  expect((error as ApiError).details.roomId).toBe('room-a');
});

test('a failure without a JSON body still says the server is unavailable', async () => {
  vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
  await expect(requestLiveKitToken(JOIN)).rejects.toMatchObject({
    message: 'Сервер недоступен',
    status: 502,
    code: ''
  });
});

test('a room check fills the top bar, and a missing room is just absent', async () => {
  stubFetch({
    '/api/rooms/room-a': {
      body: {
        ok: true,
        exists: true,
        roomId: 'room-a',
        name: 'Кухня',
        avatarUrl: null,
        isStatic: true,
        createdAt: 1,
        maxRoomPeers: 10,
        peers: 0
      }
    },
    '/api/rooms/gone': { status: 404, body: { ok: false, error: 'Комната не найдена' } }
  });
  expect(await checkRoomExists('room-a')).toBe(true);
  expect([state.roomName, state.roomAvatarUrl, state.roomIsStatic]).toEqual(['Кухня', '', true]);
  expect(await checkRoomExists('gone')).toBe(false);
});
