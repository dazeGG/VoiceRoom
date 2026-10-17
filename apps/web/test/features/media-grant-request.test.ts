// room.media.request travels over the shared socket and is answered under its
// own id; no answer at all must not hold the stream back.

import { afterEach, expect, test, vi } from 'vitest';
import type { RealtimeEvent } from '../../src/lib/api/realtime';

const TARGET = { roomId: 'room-1', peerId: 'peer-self1', sessionToken: 's'.repeat(32) };

async function loadRoomRealtime() {
  vi.resetModules();
  const sent: Array<{ type: string; payload: unknown; id?: string }> = [];
  const handlers = new Set<(event: RealtimeEvent) => void>();
  const connection = {
    send(type: string, payload: unknown, id?: string) {
      sent.push({ type, payload, id });
    },
    subscribe(handler: (event: RealtimeEvent) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }
  };
  vi.doMock('../../src/lib/api/realtime', () => ({ getAppRealtime: () => connection }));
  vi.doMock('../../src/lib/entities/room/room-presence.svelte', () => ({ applyRoomSummary: () => {} }));
  const realtime = await import('../../src/lib/entities/room/room-realtime.ts');
  const emit = (event: RealtimeEvent) => [...handlers].forEach((handler) => handler(event));
  return { realtime, sent, handlers, emit };
}

afterEach(() => {
  vi.useRealTimers();
});

test('the grant answering this request resolves it; answers to other requests do not', async () => {
  const { realtime, sent, handlers, emit } = await loadRoomRealtime();

  const pending = realtime.requestMediaGrant({ ...TARGET, kind: 'screen', profileId: 'high-60' });
  const { id } = sent[0];
  expect(sent[0]).toMatchObject({
    type: 'room.media.request',
    payload: { ...TARGET, kind: 'screen', profileId: 'high-60' }
  });

  emit({ id: 'media-other', type: 'room.media.grant', payload: { roomId: 'room-1', kind: 'screen', granted: true } });
  emit({
    id,
    type: 'room.media.grant',
    payload: { roomId: 'room-1', kind: 'screen', granted: true, profileId: 'balanced-60' }
  });

  await expect(pending).resolves.toEqual({ roomId: 'room-1', kind: 'screen', granted: true, profileId: 'balanced-60' });
  expect(handlers.size).toBe(0);
});

test('an error frame for the request resolves it with no answer', async () => {
  const { realtime, sent, emit } = await loadRoomRealtime();

  const pending = realtime.requestMediaGrant({ ...TARGET, kind: 'camera' });
  expect(realtime.isMediaRequestError(sent[0].id)).toBe(true);
  expect(realtime.isMediaRequestError('room-join-1')).toBe(false);
  emit({ type: 'error', payload: { code: 'unknown_type', message: 'Unknown', id: sent[0].id } });

  await expect(pending).resolves.toBeNull();
});

test('a server that never answers resolves the request with no answer after a few seconds', async () => {
  vi.useFakeTimers();
  const { realtime, handlers } = await loadRoomRealtime();

  const pending = realtime.requestMediaGrant({ ...TARGET, kind: 'camera' });
  await vi.advanceTimersByTimeAsync(4_000);

  await expect(pending).resolves.toBeNull();
  expect(handlers.size).toBe(0);
});
