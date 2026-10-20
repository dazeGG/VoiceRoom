// The room leaves the call when the page really goes away, not when the
// browser only asks whether it may: a click on a download (the desktop app's
// installer) fires beforeunload, the page stays, and the call must stay too.

import { afterEach, expect, test, vi } from 'vitest';

const leaveRoom = vi.fn();

vi.mock('../../src/lib/features/room/client/room/room', () => ({
  joinRoom: vi.fn(async () => {}),
  leaveRoom,
  showRoomEntryFailure: vi.fn(),
  showRoomNotFound: vi.fn(),
  showRoomRoute: vi.fn(async () => false),
  showStartScreen: vi.fn()
}));

const { mountRoomClient } = await import('../../src/lib/features/room/client/main');

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  leaveRoom.mockClear();
});

test('a download that fires beforeunload keeps the call', () => {
  unmount = mountRoomClient(document, { roomId: 'kitchen' });
  window.dispatchEvent(new Event('beforeunload'));
  expect(leaveRoom).not.toHaveBeenCalled();
});

test('the page going away leaves the call', () => {
  unmount = mountRoomClient(document, { roomId: 'kitchen' });
  window.dispatchEvent(new Event('pagehide'));
  expect(leaveRoom).toHaveBeenCalledTimes(1);
});
