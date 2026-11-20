import { expect, test, vi } from 'vitest';

vi.mock('@voice-room/call/engine/ui/toast', () => ({ showToast: vi.fn() }));

const { showToast } = await import('@voice-room/call/engine/ui/toast');
const { createVoiceEventHandler } = await import('@voice-room/call/engine/room/voice-events');
const { mapWebCallEvent } = await import('@/features/room/adapters/web-call-transport');

function handler() {
  const room = { leaveRoom: vi.fn(), showModeration: vi.fn(), showNotFound: vi.fn() };
  const handle = createVoiceEventHandler(room);
  return {
    room,
    handle: async (event: import('@/api/realtime').RealtimeEvent) => {
      const mapped = mapWebCallEvent(event);
      if (mapped) await handle(mapped);
    }
  };
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
