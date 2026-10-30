// Room lifecycle frames (room.updated / room.not_found / room.deleted) can
// reach a client on more than one channel; each takes effect once and only
// for the room this client is in.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { lobbyRoom } from '../fixtures/answers';

const showRoomNotFound = vi.fn();
const refreshRoomHeading = vi.fn();
vi.mock('@/features/room/client/room/room', () => ({ showRoomNotFound, refreshRoomHeading }));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

async function load() {
  vi.resetModules();
  setActivePinia(createPinia());
  const lifecycle = await import('@/features/room/client/room/lifecycle');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { useRoomSettingsStore } = await import('@/features/room/room-settings.store');
  const { usePageStore } = await import('@/stores/page.store');
  const roomSettingsUi = useRoomSettingsStore();
  const { showToast } = await import('@/features/room/client/ui/toast');
  state.roomId = 'room-a';
  usePageStore().screen = 'room';
  return { ...lifecycle, state, roomSettingsUi, page: usePageStore(), showToast: vi.mocked(showToast) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  showRoomNotFound.mockClear();
  refreshRoomHeading.mockClear();
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
  room.applyRoomUpdated(lobbyRoom({ roomId: 'room-b', name: 'Other', avatarUrl: null, isStatic: true }));
  await settle();
  expect(showRoomNotFound).not.toHaveBeenCalled();
  expect(room.state.roomName).not.toBe('Other');
});

test('a missing room shows the not-found screen unless it is already shown', async () => {
  const room = await load();
  room.applyRoomNotFound('room-a');
  await settle();
  expect(showRoomNotFound).toHaveBeenCalledTimes(1);

  room.page.screen = 'not-found';
  room.applyRoomNotFound('room-a');
  await settle();
  expect(showRoomNotFound).toHaveBeenCalledTimes(1);
});

test('a room update renames the room and refreshes the heading while the room is on screen', async () => {
  const room = await load();
  room.applyRoomUpdated(lobbyRoom({ roomId: 'room-a', name: 'Планёрка', avatarUrl: '/a.webp', isStatic: true }));
  await settle();
  expect(room.state).toMatchObject({ roomName: 'Планёрка', roomAvatarUrl: '/a.webp', roomIsStatic: true });
  expect(refreshRoomHeading).toHaveBeenCalledTimes(1);
});
