import { expect, test, vi } from 'vitest';

vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
const { createVoiceEventHandler } = await import('../../src/lib/features/room/client/room/voice-events');

function handler() {
  const room = { leaveRoom: vi.fn(), showModeration: vi.fn(), showNotFound: vi.fn() };
  return { room, handle: createVoiceEventHandler(room) };
}

test('a server at its voice cap tells the guest to come back later and leaves the room', async () => {
  const { room, handle } = handler();

  await handle({ type: 'server.full', payload: { roomId: 'room-1', maxVoicePeers: 600 } });

  expect(showToast).toHaveBeenCalledWith('Сервер сейчас заполнен. Попробуйте зайти через пару минут');
  expect(room.leaveRoom).toHaveBeenCalledTimes(1);
});

test('a refused join shows the text for its code, not the server wording, and leaves the room', async () => {
  const { room, handle } = handler();

  await handle({ type: 'error', payload: { code: 'room_full', message: 'Room is full' } });

  expect(showToast).toHaveBeenLastCalledWith('Комната заполнена');
  expect(room.leaveRoom).toHaveBeenCalled();
});
