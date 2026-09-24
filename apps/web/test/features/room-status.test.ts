// What the room shows about people and connections: avatar presentation and
// the connection pill/bars text derived from room state.

import { beforeEach, expect, test } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import { getAvatarPresentation } from '../../src/lib/features/room/client/ui/avatar-presentation.ts';
import { getConnectionStatusView } from '../../src/lib/features/room/client/ui/status.ts';

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
});

test('an uploaded avatar and a valid accent win over the palette; a bad accent falls back', () => {
  const uploaded = getAvatarPresentation({ name: 'Анна Смирнова', avatarColorKey: 'blue', isLocal: false, avatarUrl: '/a.webp', avatarAccent: '#123abc' });
  expect(uploaded).toMatchObject({ src: '/a.webp', background: '#123abc', foreground: '#ffffff', label: 'Анна Смирнова' });

  const fallback = getAvatarPresentation({ name: 'Анна', avatarColorKey: 'blue', isLocal: false, avatarAccent: 'red' });
  expect(fallback.src).toBeNull();
  expect(fallback.background).not.toBe('red');
  expect(fallback.initials.length).toBeGreaterThan(0);
});

test('your own tile is labelled "вы"', () => {
  expect(getAvatarPresentation({ name: 'Анна', avatarColorKey: 'blue', isLocal: true }).label).toBe('вы');
});

test('the connection pill is idle before anything connects', () => {
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'idle' });
});

test('connecting states come before the voice is up', () => {
  state.serverConnection = 'connecting';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'connecting', label: 'Подключение к серверу' });
  state.serverConnection = 'connected';
  state.voiceConnection = 'connecting';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'connecting', label: 'Подключение голоса' });
});

test('a connected voice shows the ping and turns to a warning on noticeable loss', () => {
  state.serverConnection = 'connected';
  state.voiceConnection = 'connected';
  state.localPingMs = 40;
  const healthy = getConnectionStatusView();
  expect(healthy.stateName).toBe('connected');
  expect(healthy.label).toMatch(/^Голос подключен · /);

  state.localNetwork = { ...state.localNetwork, inboundLossPct: 7 };
  const lossy = getConnectionStatusView();
  expect(lossy.stateName).toBe('warning');
  expect(lossy.label).toMatch(/^Голос нестабилен/);
  expect(lossy.title).toContain('потери к вам 7%');
});

test('voice failures are errors and a lost quality overrides a connected voice', () => {
  state.voiceConnection = 'connected';
  state.localConnectionQuality = 'lost';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'error', label: 'Голос потерян' });

  state.voiceConnection = 'no-route';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'error', label: 'Нет маршрута к голосу' });

  state.voiceConnection = 'playback-blocked';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'warning', label: 'Звук заблокирован' });
});

test('a reconnecting event channel is shown while the voice is not connected', () => {
  state.serverConnection = 'lost';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'connecting', label: 'Сервер переподключается' });
});
