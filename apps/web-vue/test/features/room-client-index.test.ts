// What the lobby may do to a running call through the room client's public
// index: an avatar changed in the settings shows on this device's own tile
// without a rejoin, and never on someone else's.

import { afterEach, expect, test } from 'vitest';
import { clientRoomName, syncLocalProfile } from '@/features/room/client/index';
import { state } from '@/features/room/client/core/room-runtime.store';
import { participant } from '../fixtures/participant';

afterEach(() => {
  state.self = null;
  state.roomId = '';
  state.roomName = '';
});

test('a new avatar reaches the local tile, and a removed one clears it', () => {
  state.self = participant({ id: 'me', name: 'Ада', isLocal: true });

  syncLocalProfile({ avatarAccent: '#112233', avatarColorKey: 'mint', avatarUrl: '/avatars/ada.webp' });
  expect(state.self).toMatchObject({ avatarAccent: '#112233', avatarColorKey: 'mint', avatarUrl: '/avatars/ada.webp' });

  syncLocalProfile({ avatarAccent: null, avatarColorKey: 'mint', avatarUrl: null });
  expect(state.self).toMatchObject({ avatarAccent: '', avatarUrl: '' });
});

test('a tile that is not this device is left alone', () => {
  state.self = participant({ id: 'p2', name: 'Боб', isLocal: false, avatarUrl: '/avatars/bob.webp' });

  syncLocalProfile({ avatarUrl: '/avatars/ada.webp' });

  expect(state.self.avatarUrl).toBe('/avatars/bob.webp');
});

test('the room client names only the room it holds', () => {
  state.roomId = 'tmp123';
  state.roomName = 'Созвон';

  expect(clientRoomName('tmp123')).toBe('Созвон');
  expect(clientRoomName('other1')).toBe('');
});
