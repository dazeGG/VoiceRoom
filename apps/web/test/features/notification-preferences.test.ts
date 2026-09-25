// Notification settings are kept on the server; this client mirrors them
// per account and never lets a late answer for another account win.

import { beforeEach, expect, test } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { freshImport } from '../helpers/fresh-module.ts';
import type * as PreferencesModule from '../../src/lib/shared/notifications/preferences.svelte.ts';

function prefs(overrides: Record<string, unknown> = {}) {
  return {
    mutedPeerIds: [],
    mutedRoomIds: [],
    presenceStatus: 'online',
    privateNotifications: false,
    doNotDisturb: false,
    ...overrides
  };
}

async function load() {
  const preferences = await freshImport<typeof PreferencesModule>(
    '/src/lib/shared/notifications/preferences.svelte.ts'
  );
  const playback = await import('../../src/lib/shared/audio/playback-policy.svelte.ts');
  return { ...preferences, ...playback };
}

beforeEach(() => localStorage.clear());

test('preferences load from the server once per account', async () => {
  const { calls } = stubFetch({
    '/api/notifications/preferences': { body: { preferences: prefs({ mutedRoomIds: ['room-a'] }) } }
  });
  const n = await load();
  await n.loadNotificationPreferences('user-1');
  await n.loadNotificationPreferences('user-1');
  expect(calls).toHaveLength(1);
  expect(n.areNotificationPreferencesLoadedFor('user-1')).toBe(true);
  expect(n.isRoomNotificationsMuted('room-a')).toBe(true);
  expect(n.isRoomNotificationsMuted('room-b')).toBe(false);
});

test('muting a room or a person goes to the server and shows its answer', async () => {
  const { calls } = stubFetch({
    '/api/notifications/preferences': { body: { preferences: prefs() } },
    'PUT /api/notifications/room/room-a/mute': {
      body: { ok: true, muted: true, preferences: prefs({ mutedRoomIds: ['room-a'] }) }
    },
    'PUT /api/notifications/dm/peer-1/mute': {
      body: { ok: true, muted: true, preferences: prefs({ mutedRoomIds: ['room-a'], mutedPeerIds: ['peer-1'] }) }
    }
  });
  const n = await load();
  await n.loadNotificationPreferences('user-1');
  await n.updateRoomNotificationsMuted('room-a', true);
  await n.updatePeerNotificationsMuted('peer-1', true);
  expect(n.isRoomNotificationsMuted('room-a')).toBe(true);
  expect(n.isPeerNotificationsMuted('peer-1')).toBe(true);
  expect(calls.slice(1).map((call) => [call.method, call.url, call.body])).toEqual([
    ['PUT', '/api/notifications/room/room-a/mute', { muted: true }],
    ['PUT', '/api/notifications/dm/peer-1/mute', { muted: true }]
  ]);
});

test('do-not-disturb silences cues and shows as the dnd status', async () => {
  stubFetch({
    '/api/notifications/preferences': { body: { preferences: prefs() } },
    'POST /api/notifications/settings': { body: { preferences: prefs({ doNotDisturb: true, presenceStatus: 'dnd' }) } }
  });
  const n = await load();
  await n.loadNotificationPreferences('user-1');
  expect(n.isDoNotDisturbPlaybackSuppressed()).toBe(false);
  await n.updateDoNotDisturb(true);
  expect(n.isDoNotDisturbEnabled()).toBe(true);
  expect(n.notificationPreferences.presenceStatus).toBe('dnd');
});

test('a mutation answer arriving after the account changed is ignored', async () => {
  stubFetch({
    '/api/notifications/preferences': { body: { preferences: prefs() } },
    'PUT /api/notifications/room/room-a/mute': {
      body: { ok: true, muted: true, preferences: prefs({ mutedRoomIds: ['room-a'] }) }
    }
  });
  const n = await load();
  await n.loadNotificationPreferences('user-1');
  const pending = n.updateRoomNotificationsMuted('room-a', true);
  n.prepareNotificationPreferences('user-2', false);
  await pending;
  expect(n.isRoomNotificationsMuted('room-a')).toBe(false);
});

test('settings pushed over realtime replace the local copy only for the signed-in account', async () => {
  stubFetch({ '/api/notifications/preferences': { body: { preferences: prefs() } } });
  const n = await load();
  await n.loadNotificationPreferences('user-1');
  n.applyRealtimeNotificationPreferences('someone-else', prefs({ mutedRoomIds: ['x'] }) as never);
  expect(n.isRoomNotificationsMuted('x')).toBe(false);
  n.applyRealtimeNotificationPreferences('user-1', prefs({ mutedRoomIds: ['x'] }) as never);
  expect(n.isRoomNotificationsMuted('x')).toBe(true);
});

test('turning notifications off is remembered on this device', async () => {
  const n = await load();
  n.setNotificationsEnabled(false);
  expect(localStorage.getItem('voice-room:notifications-enabled')).toBe('false');
  n.syncNotificationPermission();
  expect(n.notificationPreferences.notificationsEnabled).toBe(false);
});
