import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');

// One Vite server for the whole file, without a file watcher (see
// desktop-os-integration.test.js for why).
let serverPromise = null;

function getServer() {
  serverPromise ??= createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: webRoot,
    server: { hmr: false, middlewareMode: true, watch: null }
  });
  return serverPromise;
}

after(async () => {
  if (serverPromise) await (await serverPromise).close();
});

async function loadAttention(t, windowValue = {}) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowValue, writable: true });
  const originalWarn = console.warn;
  console.warn = () => {};
  t.after(() => {
    delete globalThis.window;
    console.warn = originalWarn;
  });
  const server = await getServer();
  server.moduleGraph.invalidateAll();
  return server.ssrLoadModule('/src/lib/platform/desktop-attention.ts');
}

const flush = () => new Promise((resolveFlush) => setImmediate(resolveFlush));

test('the app icon badge counts every unread room and DM except muted ones', async (t) => {
  const attention = await loadAttention(t);

  assert.equal(attention.countUnreadForBadge({
    friends: [
      { unreadCount: 2, user: { id: 'alice' } },
      { unreadCount: 5, user: { id: 'muted-bob' } },
      { unreadCount: 0, user: { id: 'carol' } }
    ],
    mutes: { mutedPeerIds: ['muted-bob'], mutedRoomIds: ['quiet-room'] },
    roomUnreadById: { 'live-room': 4, 'stale-room': 0 },
    rooms: [
      { roomId: 'live-room', unreadCount: 1 },
      { roomId: 'stale-room', unreadCount: 9 },
      { roomId: 'list-room', unreadCount: 3 },
      { roomId: 'quiet-room', unreadCount: 7 },
      { roomId: 'broken-room', unreadCount: Number.NaN }
    ]
  }), 2 + 4 + 0 + 3);
});

test('badge sync sends each change once and clears to zero', async (t) => {
  const sent = [];
  const attention = await loadAttention(t, {
    voiceRoomDesktopAttention: {
      requestAttention: async () => ({ ok: true }),
      setBadgeCount: async (count) => sent.push(count)
    }
  });

  attention.syncDesktopBadgeCount(3);
  attention.syncDesktopBadgeCount(3);
  attention.syncDesktopBadgeCount(4.7);
  attention.syncDesktopBadgeCount(-2);
  await flush();

  assert.deepEqual(sent, [3, 4, 0]);
});

test('badge sync is a no-op without the desktop bridge and retries after a failure', async (t) => {
  const bare = await loadAttention(t, {});
  assert.doesNotThrow(() => bare.syncDesktopBadgeCount(5));

  let fail = true;
  const sent = [];
  const attention = await loadAttention(t, {
    voiceRoomDesktopAttention: {
      requestAttention: async () => ({ ok: true }),
      setBadgeCount: async (count) => {
        if (fail) throw new Error('untrusted');
        sent.push(count);
      }
    }
  });
  attention.syncDesktopBadgeCount(2);
  await flush();
  fail = false;
  attention.syncDesktopBadgeCount(2);
  await flush();
  assert.deepEqual(sent, [2]);
});

test('lobby mirrors unread counts to the app icon and clears it on unmount', () => {
  const lobby = readFileSync(resolve(webRoot, 'src/lib/features/home/LobbyPage.svelte'), 'utf8');

  assert.match(lobby, /syncDesktopBadgeCount\(countUnreadForBadge\(\{[\s\S]*?friends: friendsState\.friends[\s\S]*?mutes: notificationPreferences[\s\S]*?roomUnreadById: roomPresence\.unreadCountByRoomId[\s\S]*?rooms\s*\}\)\)/);
  assert.match(lobby, /syncDesktopCallState\(\{ active: false[^)]*\}\);\s*syncDesktopBadgeCount\(0\);/);
});

test('an open chat suppresses notifications only while the window is in front', () => {
  const friends = readFileSync(resolve(webRoot, 'src/lib/features/home/model/friends.svelte.ts'), 'utf8');

  assert.match(friends, /function getActiveNotificationTarget\(\): NotificationActiveTarget \| null \{\s*[\s\S]*?document\.visibilityState !== 'visible' \|\| !document\.hasFocus\(\)[\s\S]*?return null;[\s\S]*?kind: 'dm'/);
});

test('system notifications stay silent and have a switch in the desktop app tab', () => {
  const router = readFileSync(resolve(webRoot, 'src/lib/shared/notifications/router.ts'), 'utf8');
  const modal = readFileSync(resolve(webRoot, 'src/lib/features/home/components/SettingsModal.svelte'), 'utf8');

  assert.match(router, /new globalThis\.Notification\(payload\.title, \{[\s\S]*?silent: true/);
  assert.match(modal, /\{:else if tab === 'app' && desktopApp && autostartAvailable\}[\s\S]*?\{#if !macDesktopApp\}[\s\S]*?aria-checked=\{systemNotificationsEnabled\}[\s\S]*?aria-label="Системные уведомления"[\s\S]*?toggleSystemNotifications\(\)/);
  assert.match(modal, /async function toggleSystemNotifications\(\)[\s\S]*?setNotificationsEnabled\(false\)[\s\S]*?requestNotificationsFromUiAction\(\)/);
  assert.match(modal, /<div hidden=\{desktopApp && autostartAvailable\}>\s*<div class="settings-gate-head">\s*<span class="settings-field-label">\{notificationToggleLabel\}/);
});
