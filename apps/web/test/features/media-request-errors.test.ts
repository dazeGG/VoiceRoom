import type { RealtimeEvent } from '@/api/realtime';
import { expect, test, vi } from 'vitest';
import type * as RoomRealtime from '@/entities/room/room-realtime';

vi.mock('@voiceroom/call/engine/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/entities/room/room-realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof RoomRealtime>()),
  isMediaRequestError: (id: string | undefined) => id === 'media-1'
}));

const { showToast } = await import('@voiceroom/call/engine/ui/toast');
const { createVoiceEventHandler } = await import('@voiceroom/call/engine/room/voice-events');
const { mapWebCallEvent } = await import('@/features/room/adapters/web-call-transport');

function handler() {
  const room = { leaveRoom: vi.fn(), showModeration: vi.fn(), showNotFound: vi.fn() };
  const handle = createVoiceEventHandler(room);
  return {
    room,
    handle: async (event: RealtimeEvent) => {
      const mapped = mapWebCallEvent(event);
      if (mapped) await handle(mapped);
    }
  };
}

test('a refused media request is not shown as a room error: the stream falls back on its own', async () => {
  const { room, handle } = handler();

  await handle({
    type: 'error',
    payload: { code: 'not_active_peer', message: 'Media request rejected', id: 'media-1' }
  });

  expect(showToast).not.toHaveBeenCalled();
  expect(room.leaveRoom).not.toHaveBeenCalled();
});

test('other errors are still shown', async () => {
  const { handle } = handler();

  await handle({ type: 'error', payload: { code: 'update_failed', message: 'Peer update rejected', id: 'other' } });

  expect(showToast).toHaveBeenCalledWith('Не удалось обновить состояние в комнате');
});
