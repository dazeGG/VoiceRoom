// Room lifecycle frames (room.updated / room.not_found / room.deleted) can
// reach a client on more than one channel; each takes effect once and only
// for the room this client is in.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const showRoomNotFound = vi.fn();
const refreshRoomHeading = vi.fn();
vi.mock('../../src/lib/features/room/client/room/room', () => ({ showRoomNotFound, refreshRoomHeading }));
vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

async function load() {
  vi.resetModules();
  const lifecycle = await import('../../src/lib/features/room/client/room/lifecycle.ts');
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
  const { roomSettingsUi } = await import('../../src/lib/features/room/room-settings.svelte.ts');
  const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
  state.roomId = 'room-a';
  document.body.dataset.screen = 'room';
  return { ...lifecycle, state, roomSettingsUi, showToast: vi.mocked(showToast) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  showRoomNotFound.mockClear();
  refreshRoomHeading.mockClear();
});
afterEach(() => {
  delete document.body.dataset.screen;
});

test('a deleted room tells the visitor once and leaves the room screen, however often the frame arrives', async () => {
  const room = await load();
  room.applyRoomDeleted('room-a');
  room.applyRoomDeleted('room-a');
  await settle();
  expect(room.showToast).toHaveBeenCalledTimes(1);
  expect(room.showToast).toHaveBeenCalledWith('Комната удалена владельцем');
  expect(showRoomNotFound).toHaveBeenCalledTimes(1);
});

test('the owner deleting the room is not told that the owner deleted it', async () => {
  const room = await load();
  room.roomSettingsUi.deleting = true;
  room.applyRoomDeleted('room-a');
  await settle();
  expect(room.showToast).not.toHaveBeenCalled();
  expect(showRoomNotFound).not.toHaveBeenCalled();
  room.roomSettingsUi.deleting = false;
});

test('frames about another room are ignored', async () => {
  const room = await load();
  room.applyRoomDeleted('room-b');
  room.applyRoomNotFound('room-b');
  room.applyRoomUpdated({ roomId: 'room-b', name: 'Other', avatarUrl: null, isStatic: true } as never);
  await settle();
  expect(showRoomNotFound).not.toHaveBeenCalled();
  expect(room.state.roomName).not.toBe('Other');
});

test('a missing room shows the not-found screen unless it is already shown', async () => {
  const room = await load();
  room.applyRoomNotFound('room-a');
  await settle();
  expect(showRoomNotFound).toHaveBeenCalledTimes(1);

  document.body.dataset.screen = 'not-found';
  room.applyRoomNotFound('room-a');
  await settle();
  expect(showRoomNotFound).toHaveBeenCalledTimes(1);
});

test('a room update renames the room and refreshes the heading while the room is on screen', async () => {
  const room = await load();
  room.applyRoomUpdated({ roomId: 'room-a', name: 'Планёрка', avatarUrl: '/a.webp', isStatic: true } as never);
  await settle();
  expect(room.state).toMatchObject({ roomName: 'Планёрка', roomAvatarUrl: '/a.webp', roomIsStatic: true });
  expect(refreshRoomHeading).toHaveBeenCalledTimes(1);
});
