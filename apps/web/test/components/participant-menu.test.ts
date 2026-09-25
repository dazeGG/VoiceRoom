import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { authUser } from '../fixtures/users.ts';

const relationships = new Map<string, string>();
vi.mock('../../src/lib/features/home/model/friends.svelte', () => ({
  acceptRequestByUserId: vi.fn(async () => {}),
  addFriendByUserId: vi.fn(async () => ({ status: 'sent' })),
  getFriendRelationship: (userId: string) => relationships.get(userId) ?? 'none',
  openDm: vi.fn(async () => {}),
  removeFriend: vi.fn(async () => {}),
  setMode: vi.fn()
}));
vi.mock('../../src/lib/api/rooms', () => ({
  banRoomPeer: vi.fn(async () => 'ban-1'),
  kickRoomPeer: vi.fn(async () => {}),
  setRoomPeerServerMute: vi.fn(async () => {}),
  undoRoomBan: vi.fn(async () => {})
}));
vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/lib/features/room/client/services/media-playback-service', () => ({
  applyRemoteParticipantAudioPreferences: vi.fn()
}));

const ParticipantContextMenu = (await import('../../src/lib/features/room/components/ParticipantContextMenu.svelte'))
  .default;
const friends = await import('../../src/lib/features/home/model/friends.svelte');
const roomsApi = await import('../../src/lib/api/rooms');
const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
const { applyRemoteParticipantAudioPreferences } =
  await import('../../src/lib/features/room/client/services/media-playback-service');
const { setUser, clearSession } = await import('../../src/lib/features/auth/session.svelte.ts');
const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
const { createInitialRoomState } = await import('../../src/lib/features/room/client/model/room-state.ts');
const { createParticipant } = await import('../../src/lib/features/room/client/room/participants.ts');
const { openParticipantContextMenu, participantContextMenu, closeParticipantContextMenu } =
  await import('../../src/lib/features/room/participant-context-ui.svelte.ts');
const { roomSettingsUi } = await import('../../src/lib/features/room/room-settings.svelte.ts');
const { getParticipantAudioPreference } = await import('../../src/lib/features/room/client/core/settings.ts');

const ME = authUser({ id: 'me-user' });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  relationships.clear();
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  state.roomId = 'room-a';
  roomSettingsUi.isOwner = false;
  setUser(ME);
});
afterEach(() => {
  cleanup();
  closeParticipantContextMenu('', false);
  clearSession();
});

function openFor(peer: Record<string, unknown>, variant: 'tile' | 'list' = 'tile') {
  createParticipant({ id: 'me', name: 'Я' });
  createParticipant(peer as never);
  openParticipantContextMenu(String(peer.id), 20, 20, variant);
  render(ParticipantContextMenu);
  return screen.getByRole('dialog', { name: `Действия для ${String(peer.name)}` });
}

test('there is no menu for yourself', () => {
  createParticipant({ id: 'me', name: 'Я' });
  openParticipantContextMenu('me', 10, 10);
  render(ParticipantContextMenu);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a guest only offers local sound settings', () => {
  const menu = openFor({ id: 'guest', name: 'Гость' });
  expect(within(menu).getByText('Гость: доступны только локальные настройки звука.')).toBeTruthy();
  expect(within(menu).queryByRole('button', { name: 'Написать' })).toBeNull();
  expect(within(menu).getByRole('slider', { name: 'Громкость Гость' })).toBeTruthy();
});

test('an account shows actions for the relationship: add, accept, sent, remove', async () => {
  const cases: Array<[string, string]> = [
    ['none', 'Добавить в друзья'],
    ['incoming', 'Принять заявку'],
    ['outgoing', 'Заявка отправлена'],
    ['friend', 'Удалить из друзей']
  ];
  for (const [relationship, label] of cases) {
    relationships.set('anna-user', relationship);
    const menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
    expect(within(menu).getByRole('button', { name: label })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Написать' })).toBeTruthy();
    cleanup();
    closeParticipantContextMenu('', false);
  }
});

test('adding a friend closes the menu first and reports the result', async () => {
  const menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  await userEvent.click(within(menu).getByRole('button', { name: 'Добавить в друзья' }));
  expect(participantContextMenu.open).toBe(false);
  expect(friends.addFriendByUserId).toHaveBeenCalledWith('anna-user');
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Заявка в друзья отправлена'));
});

test('a failed action shows the server message, or a fallback per action', async () => {
  vi.mocked(friends.openDm).mockRejectedValueOnce(new Error(''));
  const menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  await userEvent.click(within(menu).getByRole('button', { name: 'Написать' }));
  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('Не удалось открыть личные сообщения', { variant: 'error' })
  );
  expect(friends.setMode).toHaveBeenCalledWith('friends');
});

test('volume changes and local mute are saved for this person and applied at once', async () => {
  const menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  const slider = within(menu).getByRole('slider', { name: 'Громкость Анна' });
  await fireEvent.input(slider, { target: { value: '50' } });
  await fireEvent.change(slider, { target: { value: '50' } });
  expect(getParticipantAudioPreference('account:anna-user').volume).toBe(0.5);
  expect(applyRemoteParticipantAudioPreferences).toHaveBeenCalled();

  const muteButton = within(menu).getByRole('button', { name: /Заглушить/ });
  await userEvent.click(muteButton);
  expect(getParticipantAudioPreference('account:anna-user').muted).toBe(true);
});

test('the list variant has no audio controls', () => {
  const menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' }, 'list');
  expect(within(menu).queryByRole('slider')).toBeNull();
});

test('only the owner can moderate, after the audio controls', async () => {
  let menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  expect(within(menu).queryByRole('button', { name: /Исключить/ })).toBeNull();
  cleanup();
  closeParticipantContextMenu('', false);

  roomSettingsUi.isOwner = true;
  menu = openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  const labels = within(menu)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
  const muteIndex = labels.findIndex((label) => label.includes('Заглушить'));
  const kickIndex = labels.findIndex((label) => label.includes('Исключить'));
  const banIndex = labels.findIndex((label) => label.includes('Заблокировать'));
  expect(muteIndex).toBeGreaterThanOrEqual(0);
  expect(kickIndex).toBeGreaterThan(muteIndex);
  expect(banIndex).toBeGreaterThan(kickIndex);

  await userEvent.click(
    within(menu)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Исключить'))!
  );
  expect(roomsApi.kickRoomPeer).toHaveBeenCalledWith('room-a', 'anna');
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Анна исключён из комнаты'));
});
