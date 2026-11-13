// A join does not wait for what it does not need: every wait is a round trip,
// and a visitor far from the server pays each one in full. The room check runs
// beside the microphone, and is not repeated right after the room page made it.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { roomStatus } from '../fixtures/answers';
import { stubFetch, type Reply } from '../fixtures/fetch';
import { FakeWebSocket } from '../fixtures/fake-websocket';
import { authUser } from '../fixtures/users';

const microphone = vi.hoisted(() => {
  const held: { opened: number; stopped: unknown[]; answer: ((capture: { stopped: true } | null) => void) | null } = {
    opened: 0,
    stopped: [],
    answer: null
  };
  return held;
});

vi.mock('@/features/room/client/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/shared/log', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportVoiceJoinOutcome: vi.fn()
}));
vi.mock('@/features/room/client/services/microphone-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLocalMicrophone: () => {
    microphone.opened += 1;
    return new Promise((resolve) => (microphone.answer = resolve));
  },
  stopMicrophoneCapture: (capture: unknown) => {
    microphone.stopped.push(capture);
  }
}));
vi.mock('@/features/room/client/media/livekit-runtime', () => ({
  TRACK_SOURCE: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
  loadLiveKitClient: vi.fn(async () => ({
    Room: class {
      async connect() {
        throw new Error('no LiveKit in this test');
      }
      async disconnect() {}
      removeAllListeners() {}
    }
  }))
}));

const ROOM = { body: roomStatus({ roomId: 'abc123', name: 'Планёрка', isStatic: true }) };

async function loadRoom(routes: Record<string, Reply>) {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const { calls, fetchMock } = stubFetch(routes);
  const room = await import('@/features/room/client/room/room');
  const api = await import('@/features/room/client/net/api');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { usePageStore } = await import('@/stores/page.store');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  const roomChecks = () => calls.filter((call) => call.url === '/api/rooms/abc123').length;
  return { room, api, state, usePageStore, roomChecks, fetchMock };
}

beforeEach(() => {
  microphone.opened = 0;
  microphone.stopped = [];
  microphone.answer = null;
});

test('the microphone opens while the room check is still on its way', async () => {
  const { room, roomChecks, fetchMock } = await loadRoom({ '/api/rooms/abc123': ROOM });
  // The check never answers: the microphone must not be waiting for it.
  fetchMock.mockImplementationOnce(() => new Promise(() => {}));

  void room.joinRoom();

  await vi.waitFor(() => expect(microphone.opened).toBe(1));
  expect(roomChecks()).toBe(0);
  room.leaveRoom();
  microphone.answer?.(null);
  await Promise.resolve();
  await Promise.resolve();
});

test('a cancelled old unresolved microphone keeps the next join listen-only without a second GUM', async () => {
  const { room } = await loadRoom({ '/api/rooms/abc123': ROOM });
  const { reportVoiceJoinOutcome } = await import('@/shared/log');
  const first = room.joinRoom();
  await vi.waitFor(() => expect(microphone.opened).toBe(1));
  const answerFirst = microphone.answer;
  room.leaveRoom();
  const second = room.joinRoom();
  expect(microphone.opened).toBe(1);
  room.leaveRoom();
  answerFirst?.(null);
  await first;
  await second;
  expect(vi.mocked(reportVoiceJoinOutcome).mock.calls.map(([event]) => [event.outcome, event.stage])).toEqual([
    ['cancel', 'started'],
    ['cancel', 'started']
  ]);
});

test('a room that is gone closes the microphone the check ran beside', async () => {
  const { room, state, usePageStore } = await loadRoom({
    '/api/rooms/abc123': { status: 404, body: { ok: false, error: 'Комната не найдена', code: 'room_not_found' } }
  });
  const { reportVoiceJoinOutcome } = await import('@/shared/log');
  const { guestBrowserId } = await import('@/entities/room/guest-id');
  const reportedGuestId = guestBrowserId();

  const joining = room.joinRoom();
  await vi.waitFor(() => expect(microphone.opened).toBe(1));
  await joining;
  expect(usePageStore().screen).toBe('not-found');
  expect(state.joined).toBe(false);
  expect(vi.mocked(reportVoiceJoinOutcome).mock.calls.at(-1)?.[0]).toMatchObject({
    outcome: 'failure',
    roomId: 'abc123',
    reportedGuestId
  });

  // Permission is granted only after the answer: the capture is stopped, not kept.
  const capture = { stopped: true as const };
  microphone.answer?.(capture);
  await vi.waitFor(() => expect(microphone.stopped).toContain(capture));
  expect(state.localStream).toBeFalsy();
});

test('a cancelled join keeps the room and guest identity captured before asynchronous work', async () => {
  const { room, state } = await loadRoom({ '/api/rooms/abc123': ROOM });
  const { reportVoiceJoinOutcome } = await import('@/shared/log');
  const originalGuestId = '11111111-1111-4111-8111-111111111111';
  localStorage.setItem('voice-room:guest-id', originalGuestId);

  const joining = room.joinRoom();
  await vi.waitFor(() => expect(microphone.opened).toBe(1));
  state.roomId = 'other-room';
  localStorage.setItem('voice-room:guest-id', '22222222-2222-4222-8222-222222222222');
  room.leaveRoom();
  microphone.answer?.(null);
  await joining;

  expect(vi.mocked(reportVoiceJoinOutcome).mock.calls.at(-1)?.[0]).toMatchObject({
    outcome: 'cancel',
    roomId: 'abc123',
    reportedGuestId: originalGuestId
  });
});

test('a signed-in join does not report a guest identity even if the account later signs out', async () => {
  const { room } = await loadRoom({ '/api/rooms/abc123': ROOM });
  const { reportVoiceJoinOutcome } = await import('@/shared/log');
  const { useSessionStore } = await import('@/features/auth/session.store');
  useSessionStore().setUser(authUser());

  const joining = room.joinRoom();
  await vi.waitFor(() => expect(microphone.opened).toBe(1));
  useSessionStore().setUser(null);
  room.leaveRoom();
  microphone.answer?.(null);
  await joining;

  const outcome = vi.mocked(reportVoiceJoinOutcome).mock.calls.at(-1)?.[0];
  expect(outcome).toMatchObject({ outcome: 'cancel', roomId: 'abc123' });
  expect(outcome).not.toHaveProperty('reportedGuestId');
  expect(outcome).not.toHaveProperty('userId');
});

test('a join right after the room page checked the room does not ask again', async () => {
  const { room, api, roomChecks } = await loadRoom({ '/api/rooms/abc123': ROOM });
  await api.checkRoomExists('abc123');
  expect(roomChecks()).toBe(1);

  const joining = room.joinRoom();
  await vi.waitFor(() => expect(microphone.opened).toBe(1));
  expect(roomChecks()).toBe(1);

  microphone.answer?.(null);
  await joining;
  room.leaveRoom();
});

test('an old room check does not stand in for a new one', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const { room, api, roomChecks } = await loadRoom({ '/api/rooms/abc123': ROOM });
    await api.checkRoomExists('abc123');
    vi.setSystemTime(Date.now() + 31_000);

    const joining = room.joinRoom();
    await vi.waitFor(() => expect(roomChecks()).toBe(2));

    microphone.answer?.(null);
    await joining;
    room.leaveRoom();
  } finally {
    vi.useRealTimers();
  }
});

test('a check of another room says nothing about this one', async () => {
  const { api } = await loadRoom({
    '/api/rooms/other': { body: roomStatus({ roomId: 'other' }) }
  });
  await api.checkRoomExists('other');
  expect(api.roomCheckIsFresh('other')).toBe(true);
  expect(api.roomCheckIsFresh('abc123')).toBe(false);
});
