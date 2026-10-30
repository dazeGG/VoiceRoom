// The leave button of a room shown inside the lobby tells the lobby which room
// was left; the lobby decides what to show next.

import { expect, test, vi } from 'vitest';

vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

test('leaving a room the lobby hosts tells the lobby which room it was', async () => {
  vi.resetModules();
  const { handleLeaveButtonClick } = await import('@/features/room/client/room/room');
  const { setRoomEmbedded, setRoomShell } = await import('@/features/room/client/core/embed');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const shell = { roomLeft: vi.fn<(roomId: string) => void>(), roomsChanged: vi.fn<(roomId: string) => void>() };
  setRoomEmbedded(true);
  setRoomShell(shell);
  state.roomId = 'abc123';

  await handleLeaveButtonClick();

  expect(shell.roomLeft).toHaveBeenCalledWith('abc123');
});
