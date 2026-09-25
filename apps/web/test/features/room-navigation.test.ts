// The logged-in shell keeps three room ids apart: the room on screen
// (viewed), the mounted room client (embedded) and an explicit join request
// (joinIntent). Browsing must never start or end a call.

import { expect, test } from 'vitest';
import { freshImport } from '../helpers/fresh-module.ts';

import type * as NavigationModule from '../../src/lib/features/home/model/room-navigation.svelte.ts';

async function load() {
  const navigation = await freshImport<typeof NavigationModule>(
    '/src/lib/features/home/model/room-navigation.svelte.ts'
  );
  const voice = await import('../../src/lib/features/room/voice-session.svelte.ts');
  voice.clearConnectedVoiceRoom();
  return { ...navigation, ...voice };
}

test('previewing a room shows it without mounting a room client or a join request', async () => {
  const nav = await load();
  nav.selectRoomPreview('room-a');
  expect(nav.roomNavigation).toEqual({ viewedRoomId: 'room-a', embeddedRoomId: null, joinIntentRoomId: null });
});

test('entering a room mounts its client and records the join request', async () => {
  const nav = await load();
  nav.selectRoomForVoiceEntry('room-a');
  expect(nav.roomNavigation).toEqual({ viewedRoomId: 'room-a', embeddedRoomId: 'room-a', joinIntentRoomId: 'room-a' });
  // Following a route to the same room afterwards drops the pending join request.
  nav.routeToRoom('room-a');
  expect(nav.roomNavigation.joinIntentRoomId).toBeNull();
  expect(nav.roomNavigation.embeddedRoomId).toBe('room-a');
});

test('with a call running, the call room is visible only while it is the viewed room in rooms mode', async () => {
  const nav = await load();
  nav.setConnectedVoiceRoom('call-room');
  nav.selectRoomForVoiceEntry('call-room');
  expect(nav.connectedRoomIsViewed('rooms')).toBe(true);
  expect(nav.embeddedRoomIsVisible('rooms')).toBe(true);
  expect(nav.embeddedRoomIsVisible('friends')).toBe(false);

  nav.selectRoomPreview('other-room');
  expect(nav.connectedRoomIsViewed('rooms')).toBe(false);
  expect(nav.embeddedRoomIsVisible('rooms')).toBe(false);
  expect(nav.roomNavigation.embeddedRoomId).toBe('call-room');
});

test('going home keeps the room client while a call is running and closes it otherwise', async () => {
  const nav = await load();
  nav.setConnectedVoiceRoom('call-room');
  nav.selectRoomForVoiceEntry('call-room');
  expect(nav.routeToHome()).toEqual({ closeEmbeddedRoom: false });
  expect(nav.roomNavigation.viewedRoomId).toBeNull();

  nav.clearConnectedVoiceRoom();
  nav.selectRoomPreview('room-b');
  expect(nav.routeToHome()).toEqual({ closeEmbeddedRoom: true });
});

test('opening the active call from anywhere views and mounts the call room without a new join', async () => {
  const nav = await load();
  expect(nav.openActiveVoiceRoom()).toBeNull();
  nav.setConnectedVoiceRoom('call-room');
  nav.selectRoomPreview('other-room');
  expect(nav.openActiveVoiceRoom()).toBe('call-room');
  expect(nav.roomNavigation).toEqual({
    viewedRoomId: 'call-room',
    embeddedRoomId: 'call-room',
    joinIntentRoomId: null
  });
});

test('leaving a call closes its room client only when that room is the one on screen', async () => {
  const nav = await load();
  nav.selectRoomPreview('room-a');
  expect(nav.leaveViewedConnectedRoom('room-a')).toEqual({ closeEmbeddedRoom: true });
  expect(nav.leaveViewedConnectedRoom('room-b')).toEqual({ closeEmbeddedRoom: false });
  expect(nav.leaveViewedConnectedRoom(null)).toEqual({ closeEmbeddedRoom: false });
});

test('a hidden room client without a call is dropped, the one on screen stays', async () => {
  const nav = await load();
  nav.selectRoomForVoiceEntry('room-a');
  nav.clearDisconnectedHiddenEmbed();
  expect(nav.roomNavigation.embeddedRoomId).toBe('room-a');

  nav.selectRoomPreview('room-b');
  nav.clearDisconnectedHiddenEmbed();
  expect(nav.roomNavigation.embeddedRoomId).toBeNull();
});
