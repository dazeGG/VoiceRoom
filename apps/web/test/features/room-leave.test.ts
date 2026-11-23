// The leave button of a room shown inside the lobby tells the lobby which room
// was left; the lobby decides what to show next.

import { installWebCallPortsForTest } from '../helpers/call-ports';
import { expect, test, vi } from 'vitest';

vi.mock('@voiceroom/call/engine/ui/toast', () => ({ showToast: vi.fn() }));

test('leaving a room the lobby hosts tells the lobby which room it was', async () => {
  vi.resetModules();
  await installWebCallPortsForTest();
  const { handleLeaveButtonClick } = await import('@voiceroom/call/engine/room/room');
  const { setRoomEmbedded, setRoomShell } = await import('@voiceroom/call/engine/core/embed');
  const { state } = await import('@voiceroom/call/engine/core/room-runtime.store');
  const shell = { roomLeft: vi.fn<(roomId: string) => void>(), roomsChanged: vi.fn<(roomId: string) => void>() };
  setRoomEmbedded(true);
  setRoomShell(shell);
  state.roomId = 'abc123';

  await handleLeaveButtonClick();

  expect(shell.roomLeft).toHaveBeenCalledWith('abc123');
});
