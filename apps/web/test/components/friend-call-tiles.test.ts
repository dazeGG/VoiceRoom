import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { getParticipantAudioPreference } from '@voiceroom/call/engine/core/settings';
import { createInitialRoomState } from '@voiceroom/call/engine/model/room-state';
import * as mediaPlayback from '@voiceroom/call/engine/services/media-playback-service';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import FriendCallTiles from '@/features/friend-call/FriendCallTiles.vue';
import { participant } from '../fixtures/participant';
import { defined } from '../helpers/assert';
import { installWebCallPortsForTest } from '../helpers/call-ports';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render';

test('a friend call renders my tile before the peer tile', () => {
  const avatar = { avatarColorKey: 'blue', avatarAccent: null, avatarUrl: null };
  render(FriendCallTiles, {
    props: {
      self: { id: 'self', displayName: 'Анна', ...avatar },
      peer: { id: 'peer', displayName: 'Борис', ...avatar },
      peerStatus: 'present',
      hasEngine: false
    }
  });

  expect(screen.getAllByRole('heading')).toEqual([
    screen.getByRole('heading', { name: /^Анна/ }),
    screen.getByRole('heading', { name: 'Борис' })
  ]);
});

vi.mock('@voiceroom/call/engine/services/media-playback-service', async (importOriginal) => ({
  ...(await importOriginal<typeof mediaPlayback>()),
  applyRemoteParticipantAudioPreferences: vi.fn()
}));

const peer = { id: 'friend-account', displayName: 'Анна', avatarUrl: null, avatarAccent: null, avatarColorKey: 'blue' };
const self = { ...peer, id: 'self-account', displayName: 'Иван' };

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  localStorage.clear();
  vi.clearAllMocks();
  stubOverlayDom();
});

async function openFriendMenu() {
  await fireEvent.contextMenu(screen.getByRole('heading', { name: /^Анна/ }), { clientX: 70, clientY: 90 });
  return within(await screen.findByRole('menu', { name: 'Действия для Анна' }));
}

test('only the friend tile opens the call menu and applies local audio preferences', async () => {
  const remote = participant({ id: 'friend-seat', accountUserId: peer.id, name: peer.displayName });
  state.peers.set(remote.id, remote);
  state.self = participant({ id: 'self-seat', accountUserId: self.id, name: self.displayName, isLocal: true });
  await renderWithApp(FriendCallTiles, { props: { peer, self, peerStatus: 'present', hasEngine: true } });
  await installWebCallPortsForTest();
  const ownHeading = screen.getByRole('heading', { name: /Иван/ });
  await fireEvent.contextMenu(ownHeading);
  expect(screen.queryByRole('menu')).toBeNull();

  const menu = await openFriendMenu();
  const profile = menu.getByRole('menuitem', { name: 'Профиль' });
  const mute = menu.getByRole('menuitem', { name: 'Заглушить для меня' });
  expect(menu.getAllByRole('menuitem')).toEqual([profile, mute]);
  expect(menu.getByText('Громкость')).toBeTruthy();
  const volume = menu.getByRole('slider', { name: 'Громкость Анна' });
  volume.focus();
  await userEvent.keyboard('{End}');
  expect(getParticipantAudioPreference('account:friend-account')).toEqual({ volume: 2, muted: false });
  await userEvent.click(mute);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(getParticipantAudioPreference('account:friend-account')).toEqual({ volume: 2, muted: true });
  expect(mediaPlayback.applyRemoteParticipantAudioPreferences).toHaveBeenCalledTimes(2);
  expect(mediaPlayback.applyRemoteParticipantAudioPreferences).toHaveBeenLastCalledWith(remote);

  const reopened = await openFriendMenu();
  expect(reopened.getByRole('menuitem', { name: 'Включить для меня' })).toBeTruthy();
  await userEvent.click(ownHeading);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('the keyboard menu returns focus and opens the profile from the call snapshot', async () => {
  const { pinia } = await renderWithApp(FriendCallTiles, {
    props: { peer, self, peerStatus: 'present', hasEngine: true }
  });
  const tile = defined(
    screen.getByRole('heading', { name: peer.displayName }).closest<HTMLElement>('.participant'),
    'friend tile'
  );
  expect(tile.getAttribute('aria-haspopup')).toBe('menu');
  expect(tile.getAttribute('aria-label')).toContain('Shift+F10');
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(tile);
  await user.keyboard('{Shift>}{F10}{/Shift}');
  const profile = await screen.findByRole('menuitem', { name: 'Профиль' });
  expect(screen.queryByRole('slider')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(profile));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(tile));
  expect(screen.queryByRole('menu')).toBeNull();

  const menu = await openFriendMenu();
  await user.click(menu.getByRole('menuitem', { name: 'Профиль' }));
  const { profileCardUi } = useProfileCardUiStore(pinia);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(profileCardUi).toMatchObject({
    open: true,
    person: { userId: peer.id, name: peer.displayName, avatarColorKey: peer.avatarColorKey },
    restoreFocus: tile
  });
});
