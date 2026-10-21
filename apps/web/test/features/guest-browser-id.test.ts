// Every voice join carries this browser's lasting guest id: made once, kept in
// storage, the same on the next join and after a reload, and replaced when
// what storage holds is not an id.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { normalizeGuestId } from '@voice-room/shared/validation';

const sent: Array<{ type: string; payload: unknown }> = [];

async function loadRoomRealtime() {
  vi.resetModules();
  vi.doMock('../../src/lib/api/realtime', () => ({
    getAppRealtime: () => ({
      ensureConnected() {},
      getConnectionEpoch: () => 1,
      isConnected: () => true,
      onRestore: () => () => {},
      send(type: string, payload: unknown) {
        sent.push({ type, payload });
      },
      subscribe: () => () => {}
    })
  }));
  vi.doMock('../../src/lib/entities/room/room-presence.svelte', () => ({ applyRoomSummary: () => {} }));
  return import('../../src/lib/entities/room/room-realtime.ts');
}

function join(realtime: Awaited<ReturnType<typeof loadRoomRealtime>>): unknown {
  realtime.joinVoiceRoom({ roomId: 'porch', peerId: 'peer-guest-1', sessionToken: 'g'.repeat(32), name: 'Петя' });
  return sent.at(-1)?.payload;
}

function guestIdOf(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('guestId' in payload)) return '';
  return normalizeGuestId(payload.guestId);
}

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('../../src/lib/api/realtime');
  vi.doUnmock('../../src/lib/entities/room/room-presence.svelte');
});

test('a voice join carries one lasting guest id, kept across joins and reloads', async () => {
  const first = guestIdOf(join(await loadRoomRealtime()));
  expect(first).not.toBe('');
  expect(localStorage.getItem('voice-room:guest-id')).toBe(first);
  expect(guestIdOf(join(await loadRoomRealtime()))).toBe(first);
});

test('a value in storage that is not an id is replaced', async () => {
  localStorage.setItem('voice-room:guest-id', 'not-an-id');
  const id = guestIdOf(join(await loadRoomRealtime()));
  expect(id).not.toBe('');
  expect(localStorage.getItem('voice-room:guest-id')).toBe(id);
});
