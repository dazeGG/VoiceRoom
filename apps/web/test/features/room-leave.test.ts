// The leave button of a room shown inside the lobby tells the lobby which room
// was left; the lobby decides what to show next.

import { expect, test, vi } from 'vitest';

vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

test('leaving a room the lobby hosts tells the lobby which room it was', async () => {
  vi.resetModules();
  const { handleLeaveButtonClick } = await import('../../src/lib/features/room/client/room/room.ts');
  const { setRoomEmbedded, setRoomShell } = await import('../../src/lib/features/room/client/core/embed.ts');
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
  const shell = { roomLeft: vi.fn<(roomId: string) => void>(), roomsChanged: vi.fn<(roomId: string) => void>() };
  setRoomEmbedded(true);
  setRoomShell(shell);
  state.roomId = 'abc123';

  await handleLeaveButtonClick();

  expect(shell.roomLeft).toHaveBeenCalledWith('abc123');
});
