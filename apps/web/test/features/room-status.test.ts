// What the room shows about people and connections: avatar presentation and
// the connection pill/bars text derived from room state.

import { beforeEach, expect, test } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state.ts';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation.ts';
import { getConnectionStatusView } from '@/features/room/client/ui/status.ts';

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
});

test('an uploaded avatar and a valid accent win over the palette; a bad accent falls back', () => {
  const uploaded = getAvatarPresentation({
    name: 'Анна Смирнова',
    avatarColorKey: 'blue',
    isLocal: false,
    avatarUrl: '/a.webp',
    avatarAccent: '#123abc'
  });
  expect(uploaded).toMatchObject({
    src: '/a.webp',
    background: '#123abc',
    foreground: '#ffffff',
    label: 'Анна Смирнова'
  });

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

test('a connected voice shows the ping, and the loss on the line only in the tooltip', () => {
  state.serverConnection = 'connected';
  state.voiceConnection = 'connected';
  state.localPingMs = 40;
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'connected', label: 'Голос подключен · 40 мс' });

  // Loss that RED and FEC repaired is not heard: until the server says otherwise the voice is fine.
  state.localNetwork = { inboundLossPct: 12, jitterMs: 45, outboundLossPct: 0, transport: 'relay' };
  const lossy = getConnectionStatusView();
  expect(lossy).toMatchObject({ stateName: 'connected', label: 'Голос подключен · 40 мс' });
  expect(lossy.title).toBe(
    'Пинг до LiveKit 40 мс · потери от вас 0% · потери к вам 12% · джиттер 45 мс · через ретранслятор (UDP недоступен)'
  );
});

test("the pill shows the server's verdict on what the room heard, and whose side the trouble is on", () => {
  state.serverConnection = 'connected';
  state.voiceConnection = 'connected';
  state.localPingMs = 2;
  state.voiceQuality = { level: 'unstable', cause: 'hears_badly' };
  expect(getConnectionStatusView()).toMatchObject({
    stateName: 'warning',
    label: 'Голос нестабилен · собеседников плохо слышно · 2 мс'
  });

  state.voiceQuality = { level: 'bad', cause: 'heard_badly' };
  expect(getConnectionStatusView()).toMatchObject({
    stateName: 'error',
    label: 'Плохая связь · вас плохо слышно · 2 мс'
  });

  state.localPingMs = 700;
  state.voiceQuality = { level: 'unstable', cause: 'delay' };
  expect(getConnectionStatusView()).toMatchObject({
    stateName: 'warning',
    label: 'Голос нестабилен · большая задержка · 700 мс'
  });

  state.voiceQuality = { level: 'good', cause: null };
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'connected', label: 'Голос подключен · 700 мс' });
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
  state.serverConnection = 'reconnecting';
  expect(getConnectionStatusView()).toMatchObject({ stateName: 'connecting', label: 'Сервер переподключается' });
});
