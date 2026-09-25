import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';

async function loadAttention(windowValue = {}) {
  vi.stubGlobal('window', windowValue);
  const originalWarn = console.warn;
  console.warn = () => {};
  onTestFinished(() => {
    console.warn = originalWarn;
  });
  vi.resetModules();
  return import('../src/lib/platform/desktop-attention.ts');
}

const flush = () => new Promise((resolveFlush) => setImmediate(resolveFlush));

test('the app icon badge counts every unread room and DM except muted ones', async () => {
  const attention = await loadAttention();

  assert.equal(
    attention.countUnreadForBadge({
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
    }),
    2 + 4 + 0 + 3
  );
});

test('badge sync sends each change once and clears to zero', async () => {
  const sent: number[] = [];
  const attention = await loadAttention({
    voiceRoomDesktopAttention: {
      requestAttention: async () => ({ ok: true }),
      setBadgeCount: async (count: number) => sent.push(count)
    }
  });

  attention.syncDesktopBadgeCount(3);
  attention.syncDesktopBadgeCount(3);
  attention.syncDesktopBadgeCount(4.7);
  attention.syncDesktopBadgeCount(-2);
  await flush();

  assert.deepEqual(sent, [3, 4, 0]);
});

test('badge sync is a no-op without the desktop bridge and retries after a failure', async () => {
  const bare = await loadAttention({});
  assert.doesNotThrow(() => bare.syncDesktopBadgeCount(5));

  let fail = true;
  const sent: number[] = [];
  const attention = await loadAttention({
    voiceRoomDesktopAttention: {
      requestAttention: async () => ({ ok: true }),
      setBadgeCount: async (count: number) => {
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
