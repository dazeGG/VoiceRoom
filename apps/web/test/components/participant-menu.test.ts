import type * as RoomsApi from '@/api/rooms';
import { screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Pinia } from 'pinia';
import { defineComponent, h, provide } from 'vue';
import { authUser } from '../fixtures/users.ts';
import type { Relationship } from '@/api/friends';
import { ROOM_SOCIAL_KEY, type RoomSocial } from '@/features/room/social';
import type { PeerInfo } from '@voice-room/call/engine/core/types';
import { defined } from '../helpers/assert.ts';
import { installWebCallPortsForTest } from '../helpers/call-ports.ts';
import { renderWithApp } from '../helpers/render.ts';
import { settle, stubOverlayDom } from '../helpers/overlay-dom.ts';

const relationships = new Map<string, Relationship>();
const social = {
  friends: () => [],
  relationship: (userId: string) => relationships.get(userId) ?? 'none',
  knownLogin: () => '',
  addFriend: vi.fn(async (userId: string) => ({ status: 'sent' as const, user: authUser({ id: userId }) })),
  acceptRequest: vi.fn(async () => {}),
  removeFriend: vi.fn(async () => {}),
  openDm: vi.fn(async () => {}),
  showFriends: vi.fn()
} satisfies RoomSocial;
vi.mock('@/api/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof RoomsApi>()),
  banRoomPeer: vi.fn(async () => 'ban-1'),
  kickRoomPeer: vi.fn(async () => {}),
  setRoomPeerServerMute: vi.fn(async () => {}),
  undoRoomBan: vi.fn(async () => {})
}));
vi.mock('@voice-room/call/engine/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@voice-room/call/engine/services/media-playback-service', () => ({
  applyRemoteParticipantAudioPreferences: vi.fn()
}));

const ParticipantContextMenu = (await import('@/features/room/components/ParticipantContextMenu.vue')).default;
const roomsApi = await import('@/api/rooms');
const { showToast } = await import('@voice-room/call/engine/ui/toast');
const { applyRemoteParticipantAudioPreferences } =
  await import('@voice-room/call/engine/services/media-playback-service');
const { useSessionStore } = await import('@/features/auth/session.store');
const { state } = await import('@voice-room/call/engine/core/room-runtime.store');
const { createInitialRoomState } = await import('@voice-room/call/engine/model/room-state');
const { createParticipant } = await import('@voice-room/call/engine/room/participants');
const { useParticipantContextUiStore } = await import('@/features/room/participant-context-ui.store');
const { useRoomSettingsStore } = await import('@/features/room/room-settings.store');
const { getParticipantAudioPreference } = await import('@voice-room/call/engine/core/settings');

const ME = authUser({ id: 'me-user' });

// Provides the social graph the way the lobby does, then the menu.
const Host = defineComponent(() => {
  provide(ROOM_SOCIAL_KEY, social);
  return () => h('div', [h(ParticipantContextMenu)]);
});

let pinia: Pinia;

beforeEach(() => {
  stubOverlayDom();
  localStorage.clear();
  vi.clearAllMocks();
  relationships.clear();
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  state.roomId = 'room-a';
});
afterEach(() => {
  useParticipantContextUiStore(pinia).closeParticipantContextMenu('', false);
});

async function mount() {
  ({ pinia } = await renderWithApp(Host));
  useSessionStore(pinia).setUser(ME);
  useRoomSettingsStore(pinia).isOwner = false;
}

async function openFor(peer: PeerInfo, variant: 'tile' | 'list' = 'tile') {
  await mount();
  createParticipant({ id: 'me', name: 'Я' });
  createParticipant(peer);
  useParticipantContextUiStore(pinia).openParticipantContextMenu(String(peer.id), 20, 20, variant);
  return await screen.findByRole('menu', { name: `Действия для ${String(peer.name)}` });
}

test('there is no menu for yourself', async () => {
  await mount();
  createParticipant({ id: 'me', name: 'Я' });
  useParticipantContextUiStore(pinia).openParticipantContextMenu('me', 10, 10);
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
});

test('a guest only offers local sound settings', async () => {
  const menu = await openFor({ id: 'guest', name: 'Гость' });
  expect(within(menu).getByText('Гость: доступны только локальные настройки звука.')).toBeTruthy();
  expect(within(menu).queryByRole('menuitem', { name: 'Написать' })).toBeNull();
  expect(within(menu).getByRole('slider', { name: 'Громкость Гость' })).toBeTruthy();
});

test('an account shows actions for the relationship: add, accept, sent, remove', async () => {
  const cases: Array<[Relationship, string]> = [
    ['none', 'Добавить в друзья'],
    ['incoming', 'Принять заявку'],
    ['outgoing', 'Заявка отправлена'],
    ['friend', 'Удалить из друзей']
  ];
  for (const [relationship, label] of cases) {
    relationships.set('anna-user', relationship);
    const menu = await openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
    expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Написать' })).toBeTruthy();
    useParticipantContextUiStore(pinia).closeParticipantContextMenu('', false);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    state.peers.clear();
  }
});

test('adding a friend closes the menu first and reports the result', async () => {
  const menu = await openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Добавить в друзья' }));
  expect(useParticipantContextUiStore(pinia).open).toBe(false);
  expect(social.addFriend).toHaveBeenCalledWith('anna-user');
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Заявка в друзья отправлена'));
});

test('a failed action shows the server message, or a fallback per action', async () => {
  vi.mocked(social.openDm).mockRejectedValueOnce(new Error(''));
  const menu = await openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Написать' }));
  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('Не удалось открыть личные сообщения', { variant: 'error' })
  );
  expect(social.showFriends).toHaveBeenCalled();
});

test('volume changes and local mute are saved for this person and applied at once', async () => {
  const menu = await openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  await installWebCallPortsForTest();
  const slider = within(menu).getByRole('slider', { name: 'Громкость Анна' });
  slider.focus();
  await userEvent.keyboard('{Home}');
  expect(getParticipantAudioPreference('account:anna-user').volume).toBe(0);
  expect(applyRemoteParticipantAudioPreferences).toHaveBeenCalled();

  const muteButton = within(menu).getByRole('menuitem', { name: /Заглушить/ });
  await userEvent.click(muteButton);
  expect(getParticipantAudioPreference('account:anna-user').muted).toBe(true);
});

test('the list variant has no audio controls', async () => {
  const menu = await openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' }, 'list');
  expect(within(menu).queryByRole('slider')).toBeNull();
});

test('only the owner can moderate, after the audio controls', async () => {
  let menu = await openFor({ id: 'anna', name: 'Анна', accountUserId: 'anna-user' });
  expect(within(menu).queryByRole('menuitem', { name: /Исключить/ })).toBeNull();
  useParticipantContextUiStore(pinia).closeParticipantContextMenu('', false);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

  useRoomSettingsStore(pinia).isOwner = true;
  useParticipantContextUiStore(pinia).openParticipantContextMenu('anna', 20, 20, 'tile');
  menu = await screen.findByRole('menu', { name: 'Действия для Анна' });
  const labels = within(menu)
    .getAllByRole('menuitem')
    .map((button) => button.textContent?.trim() ?? '');
  const muteIndex = labels.findIndex((label) => label.includes('Заглушить'));
  const kickIndex = labels.findIndex((label) => label.includes('Исключить'));
  const banIndex = labels.findIndex((label) => label.includes('Заблокировать'));
  expect(muteIndex).toBeGreaterThanOrEqual(0);
  expect(kickIndex).toBeGreaterThan(muteIndex);
  expect(banIndex).toBeGreaterThan(kickIndex);

  await userEvent.click(
    defined(
      within(menu)
        .getAllByRole('menuitem')
        .find((button) => button.textContent?.includes('Исключить')),
      'kick button'
    )
  );
  expect(roomsApi.kickRoomPeer).toHaveBeenCalledWith('room-a', 'anna');
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Анна исключён из комнаты'));
});
