// Every voice join carries this browser's lasting guest id: made once, kept in
// storage, the same on the next join and after a reload, and replaced when
// what storage holds is not an id.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { normalizeGuestId } from '@voice-room/shared/validation';

const sent: Array<{ type: string; payload: unknown }> = [];

async function loadRoomRealtime() {
  vi.resetModules();
  vi.doMock('@/api/realtime', () => ({
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
  vi.doMock('@/entities/room/room-presence.store', () => ({
    useRoomPresenceStore: () => ({ applyRoomSummary: () => {} })
  }));
  return import('@/entities/room/room-realtime');
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
  vi.doUnmock('@/api/realtime');
  vi.doUnmock('@/entities/room/room-presence.store');
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

test('account and guest joins share the existing profile id without changing credentials', async () => {
  const id = 'b9eadc0a-7504-4d93-bd0c-b29827642c4a';
  localStorage.setItem('voice-room:guest-id', id);
  const realtime = await loadRoomRealtime();
  realtime.joinVoiceRoom({ roomId: 'porch', peerId: 'account-peer', sessionToken: 'a'.repeat(32), name: 'Аня' });
  expect(sent.at(-1)).toEqual({
    type: 'room.join',
    payload: {
      roomId: 'porch',
      peerId: 'account-peer',
      sessionToken: 'a'.repeat(32),
      name: 'Аня',
      guestId: id,
      clientId: id
    }
  });
  expect(join(realtime)).toMatchObject({ guestId: id, clientId: id, peerId: 'peer-guest-1' });
  expect(localStorage.getItem('voice-room:guest-id')).toBe(id);
});

test('unavailable storage does not block a voice join or fabricate a stable id', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  try {
    const payload = join(await loadRoomRealtime());
    expect(payload).toEqual({ roomId: 'porch', peerId: 'peer-guest-1', sessionToken: 'g'.repeat(32), name: 'Петя' });
  } finally {
    get.mockRestore();
  }
});
