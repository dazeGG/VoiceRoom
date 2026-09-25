import { expect, test, vi } from 'vitest';
import { ApiRequestError, postJson } from '../../src/lib/features/room/client/net/api.ts';
import { stubFetch } from '../fixtures/fetch.ts';

test('a refused request keeps the server message, code, room and HTTP status', async () => {
  stubFetch({ 'POST /api/livekit-token': { status: 403, body: { ok: false, error: 'Вы заблокированы', code: 'room_banned', roomId: 'room-a' } } });
  const error: unknown = await postJson('/api/livekit-token', {}).then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({ message: 'Вы заблокированы', code: 'room_banned', roomId: 'room-a', status: 403 });
});

test('a failure without a JSON body still says the server is unavailable', async () => {
  vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
  await expect(postJson('/api/rooms/x/peers', {})).rejects.toMatchObject({ message: 'Сервер недоступен', status: 502, code: '' });
});
