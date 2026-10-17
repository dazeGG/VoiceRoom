import { expect, test, vi } from 'vitest';
import type * as RoomRealtime from '../../src/lib/entities/room/room-realtime';

vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/lib/entities/room/room-realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof RoomRealtime>()),
  isMediaRequestError: (id: string | undefined) => id === 'media-1'
}));

const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
const { createVoiceEventHandler } = await import('../../src/lib/features/room/client/room/voice-events');

function handler() {
  const room = { leaveRoom: vi.fn(), showModeration: vi.fn(), showNotFound: vi.fn() };
  return { room, handle: createVoiceEventHandler(room) };
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

  expect(showToast).toHaveBeenCalledWith('Peer update rejected');
});
