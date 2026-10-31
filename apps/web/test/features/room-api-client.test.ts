// The room client's API calls: LiveKit credentials come with every address to
// try, refusals keep what the recovery logic keys on, and a room check fills
// the top bar.

import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { state } from '@/features/room/client/core/room-runtime.store';
import { checkRoomExists, requestLiveKitToken } from '@/features/room/client/net/api';
import { resetRuntimeConfig } from '@/platform/runtime-config';
import { stubFetch } from '../fixtures/fetch';
import { instanceOf } from '../helpers/assert';

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
  expect(calls.find((call) => call.method === 'POST')).toMatchObject({ url: '/api/livekit-token', body: JOIN });
});

test('the LiveKit address list is asked for while the token request is still out', async () => {
  const asked: string[] = [];
  let answerToken: () => void = () => {};
  const tokenAnswered = new Promise<void>((resolve) => (answerToken = resolve));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/runtime-config.json')) {
      asked.push('config');
      return new Response('', { status: 404 });
    }
    asked.push('token');
    await tokenAnswered;
    return new Response(JSON.stringify(ADMISSION), { headers: { 'content-type': 'application/json' } });
  });

  const credentials = requestLiveKitToken(JOIN);
  await vi.waitFor(() => expect(asked).toContain('token'));
  await vi.waitFor(() => expect(asked).toContain('config'));
  answerToken();
  expect((await credentials).urls).toEqual(['wss://lk.example/']);
  expect(asked).toEqual(['config', 'token']);
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
  expect(instanceOf(error, ApiError, 'refusal').details.roomId).toBe('room-a');
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
