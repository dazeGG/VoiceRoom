import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import type { RoomCapabilities } from '@voice-room/shared/contracts/rooms';
import { callPageState } from '@voice-room/call/engine/core/call-page.store';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { mountGuestRoomClient } from '@voice-room/call/engine/main';
import { joinRoom } from '@voice-room/call/engine/room/room';
import { createGuestJoinController } from '@voice-room/call/guest';
import { createMeetApi } from '@/adapters/meet-api';

vi.mock('@voice-room/call/engine/main', () => ({ mountGuestRoomClient: vi.fn() }));
vi.mock('@voice-room/call/engine/room/room', () => ({ joinRoom: vi.fn() }));

const room = {
  roomId: 'meet-abc',
  capabilities: { camera: true, screenShare: true, chat: 'none' as const, maxPeers: 16 },
  peers: 0
};
const unmount = vi.fn(() => {
  state.joined = false;
});

function setup(status: Parameters<typeof createGuestJoinController>[0]['status'] = async () => room) {
  const setDisplayName = vi.fn();
  const admissionCapabilities = shallowRef<RoomCapabilities | null>(null);
  const controller = createGuestJoinController({
    roomId: room.roomId,
    status,
    setDisplayName,
    admissionCapabilities
  });
  return { controller, setDisplayName, admissionCapabilities };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  state.joined = false;
  state.serverConnection = 'idle';
  state.voiceConnection = 'idle';
  vi.mocked(mountGuestRoomClient).mockImplementation(() => {
    callPageState().screen = 'room';
    return unmount;
  });
  vi.mocked(joinRoom).mockImplementation(async () => {
    state.serverConnection = 'connected';
    state.voiceConnection = 'connected';
    state.joined = true;
  });
});

describe('guest join controller', () => {
  it('checks the room before asking for a name, then starts the engine only for a named guest', async () => {
    const statusResult = Promise.withResolvers<typeof room | null>();
    const status = vi.fn(() => statusResult.promise);
    const { controller, setDisplayName } = setup(status);
    const checking = controller.check();
    expect(status).toHaveBeenCalledWith(room.roomId);
    expect(controller.phase.value).toBe('checking');
    await controller.join('Ada');
    expect(mountGuestRoomClient).not.toHaveBeenCalled();

    statusResult.resolve(room);
    await checking;
    expect(controller.phase.value).toBe('name');
    await controller.join('  ');
    expect(controller.failure.value).toBe('name-required');
    expect(setDisplayName).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();

    const rosterAndMedia = Promise.withResolvers<void>();
    vi.mocked(joinRoom).mockImplementationOnce(async () => {
      await rosterAndMedia.promise;
      state.serverConnection = 'connected';
      state.voiceConnection = 'connected';
      state.joined = true;
    });
    const joining = controller.join('  Ada   Lovelace  ');
    await controller.join('Duplicate submission');
    expect(controller.phase.value).toBe('joining');
    expect(controller.failure.value).toBeNull();
    expect(setDisplayName).toHaveBeenCalledExactlyOnceWith('Ada Lovelace');
    expect(mountGuestRoomClient).toHaveBeenCalledExactlyOnceWith(room.roomId, 'Ada Lovelace', expect.any(Number));
    expect(joinRoom).toHaveBeenCalledTimes(1);

    rosterAndMedia.resolve();
    await joining;
    expect(controller.phase.value).toBe('call');
    controller.leave();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(controller.phase.value).toBe('left');
  });

  it('reflects the installed runtime reconnecting and server capability limits', async () => {
    const { controller, admissionCapabilities } = setup();
    await controller.check();
    expect(controller.capabilities.value).toEqual(room.capabilities);
    await controller.join('Ada');
    admissionCapabilities.value = { ...room.capabilities, camera: false, maxPeers: 8 };
    expect(controller.capabilities.value).toMatchObject({ camera: false, screenShare: true, maxPeers: 8 });
    state.serverConnection = 'reconnecting';
    expect(controller.phase.value).toBe('reconnecting');
    state.serverConnection = 'connecting';
    expect(controller.phase.value).toBe('reconnecting');
    state.serverConnection = 'connected';
    state.voiceConnection = 'signal-reconnecting';
    expect(controller.phase.value).toBe('reconnecting');
    state.voiceConnection = 'connected';
    expect(controller.phase.value).toBe('call');
    state.joined = false;
    expect(controller.phase.value).toBe('closed');
    expect(controller.failure.value).toBe('closed');
    controller.dispose();
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('allows retrying a failed status and distinguishes a missing room', async () => {
    const status = vi
      .fn<() => Promise<typeof room | null>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(null);
    const { controller } = setup(status);
    await controller.check();
    expect(controller.phase.value).toBe('error');
    expect(controller.failure.value).toBe('status');
    await controller.check();
    expect(controller.phase.value).toBe('not-found');
    expect(controller.room.value).toBeNull();
    expect(controller.failure.value).toBeNull();
    await controller.join('Ada');
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it('cleans a failed engine attempt and allows retrying without another status request', async () => {
    const status = vi.fn(async () => room);
    const { controller } = setup(status);
    await controller.check();
    vi.mocked(joinRoom).mockResolvedValueOnce(undefined);
    await controller.join('Ada');
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(controller.phase.value).toBe('name');
    expect(controller.failure.value).toBe('join');
    await controller.join('Ada');
    expect(controller.phase.value).toBe('call');
    expect(status).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('moves to the missing-room screen when the room closes between status and joining', async () => {
    const { controller } = setup();
    await controller.check();
    vi.mocked(joinRoom).mockImplementationOnce(async () => {
      callPageState().screen = 'not-found';
    });
    await controller.join('Ada');
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(controller.phase.value).toBe('not-found');
    expect(controller.room.value).toBeNull();
    expect(controller.failure.value).toBeNull();
  });

  it('ignores a stale status response after disposal', async () => {
    const deferred = Promise.withResolvers<typeof room | null>();
    const { controller } = setup(() => deferred.promise);
    const checking = controller.check();
    controller.dispose();
    deferred.resolve(room);
    await checking;
    expect(controller.phase.value).toBe('left');
    expect(controller.room.value).toBeNull();
    await controller.join('Ada');
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it('leaves during an in-flight join without letting its completion alter the leave screen', async () => {
    const deferred = Promise.withResolvers<void>();
    const { controller } = setup();
    await controller.check();
    vi.mocked(joinRoom).mockReturnValueOnce(deferred.promise);
    const joining = controller.join('Ada');
    controller.leave();
    deferred.reject(new Error('admission cancelled'));
    await joining;
    expect(controller.phase.value).toBe('left');
    expect(controller.failure.value).toBeNull();
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});

describe('Meet room status recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps checking across network and server failures, then shows the name step', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ...room, ok: true }));
    const { controller } = setup(createMeetApi(fetcher).status);
    const checking = controller.check();

    await vi.advanceTimersByTimeAsync(249);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(controller.phase.value).toBe('checking');
    expect(controller.failure.value).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.phase.value).toBe('checking');
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await vi.runAllTimersAsync();
    await checking;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(controller.phase.value).toBe('name');
    expect(controller.room.value).toMatchObject(room);
  });

  it('shows the status error after exhausting retries and allows another check', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 502 }));
    const { controller } = setup(createMeetApi(fetcher).status);
    const checking = controller.check();

    await vi.runAllTimersAsync();
    await checking;
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(controller.phase.value).toBe('error');
    expect(controller.failure.value).toBe('status');

    fetcher.mockResolvedValueOnce(Response.json({ ...room, ok: true }));
    await controller.check();
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(controller.phase.value).toBe('name');
  });

  it.each([404, 403])('does not retry an HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    const { controller } = setup(createMeetApi(fetcher).status);
    const checking = controller.check();

    await vi.runAllTimersAsync();
    await checking;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(controller.phase.value).toBe(status === 404 ? 'not-found' : 'error');
  });

  it('stops retrying when the page is left during backoff', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const lifetime = new AbortController();
    const api = createMeetApi(fetcher);
    const { controller } = setup((roomId) => api.status(roomId, lifetime.signal));
    const checking = controller.check();

    await vi.advanceTimersByTimeAsync(100);
    expect(controller.phase.value).toBe('checking');
    lifetime.abort();
    controller.dispose();
    await vi.runAllTimersAsync();
    await checking;

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(controller.phase.value).toBe('left');
  });
});
