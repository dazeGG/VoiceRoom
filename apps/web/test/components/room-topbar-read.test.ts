// Opening the chat from the room's top bar marks the room read for an account,
// but only a permanent room: read state is kept for rooms in the account's
// list, and a temporary room is never there.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import RoomTopbar from '@/features/room/components/RoomTopbar.vue';
import { state as roomClientState } from '@voiceroom/call/engine/core/room-runtime.store';
import { useRoomUiStore } from '@/features/room/room-ui.store';
import { usePageStore } from '@/stores/page.store';
import { webCallTransport } from '@/features/room/adapters/web-call-transport';
import { ApiError } from '@/api/client';
import { leaveRoom } from '@voiceroom/call/engine/room/room';
import type { CallRealtimeEvent } from '@voiceroom/call/engine/transport';
import * as cues from '@voiceroom/call/engine/media/cues';
import * as devices from '@voiceroom/call/engine/ui/devices';
import * as livekit from '@voiceroom/call/engine/services/livekit-service';
import * as toast from '@voiceroom/call/engine/ui/toast';
import { stubFetch } from '../fixtures/fetch.ts';
import { roomStatus } from '../fixtures/answers.ts';
import { participant } from '../fixtures/participant.ts';
import { renderWithApp } from '../helpers/render.ts';
import { installWebCallPortsForTest } from '../helpers/call-ports.ts';
import * as recovery from '@voiceroom/call/engine/recovery/room-recovery';

afterEach(() => {
  roomClientState.roomId = '';
  roomClientState.roomIsStatic = false;
  roomClientState.self = null;
});

async function openChatIn(room: { isStatic: boolean }) {
  const { calls } = stubFetch({
    'POST /api/rooms/abc123/read': { body: { ok: true, roomId: 'abc123', lastReadAt: 1 } }
  });
  roomClientState.roomId = 'abc123';
  roomClientState.roomIsStatic = room.isStatic;
  roomClientState.self = participant({ id: 'p1', name: 'Аня', accountUserId: 'u1' });
  const { pinia } = await renderWithApp(RoomTopbar);
  usePageStore(pinia).screen = 'room';
  await nextTick();
  await userEvent.click(screen.getByRole('button', { name: 'Чат' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  useRoomUiStore(pinia).closeChat();
  return calls.filter((call) => call.url.endsWith('/read'));
}

test('opening the chat of a permanent room marks it read', async () => {
  expect(await openChatIn({ isStatic: true })).toHaveLength(1);
});

test('opening the chat of a temporary room asks for nothing', async () => {
  expect(await openChatIn({ isStatic: false })).toEqual([]);
});

test('R7/R8: a visible reconnect action leaves and rejoins voice once and clears only on media success', async () => {
  const { pinia, router } = await renderWithApp(RoomTopbar, { route: '/r/abc123' });
  await installWebCallPortsForTest();
  const page = usePageStore(pinia);
  page.screen = 'room';
  const member = { roomId: 'abc123', peerId: 'peer-resync', sessionToken: 's'.repeat(32) };
  Object.assign(roomClientState, { ...member, joined: true });
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: member.roomId }) } });
  const firstMedia = Promise.withResolvers<boolean>();
  const media = vi.spyOn(livekit, 'connectLiveKitRoom').mockReturnValueOnce(firstMedia.promise).mockResolvedValue(true);
  vi.spyOn(devices, 'acquireMicrophoneForJoin').mockResolvedValue(null);
  const shownToast = vi.spyOn(toast, 'showToast');
  const voiceLostCue = vi.spyOn(cues, 'playVoiceLostCue').mockImplementation(() => {});
  const commands: string[] = [];
  const realtime = webCallTransport.realtime;
  const roomEvents = new Set<(event: CallRealtimeEvent) => void>();
  vi.spyOn(realtime, 'subscribeRoom').mockImplementation((_roomId, handler) => {
    roomEvents.add(handler);
    return () => {
      roomEvents.delete(handler);
    };
  });
  vi.spyOn(realtime, 'ensureConnected').mockImplementation(() => {});
  vi.spyOn(realtime, 'requestResync').mockReturnValue(true);
  vi.spyOn(realtime, 'leave').mockImplementation(() => {
    commands.push('leave');
  });
  const join = vi.spyOn(realtime, 'join').mockImplementation(() => {
    commands.push('join');
  });
  recovery.setRoomRecoveryLiveKitAdapter({
    attemptFreshReplacement: async () => ({ retryable: false, code: 'invalid_session' })
  });
  recovery.startRoomRecovery(1, true);
  recovery.notifyLiveKitDisconnected();
  recovery.notifyRoomSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  try {
    expect((await screen.findByRole('status')).textContent).toContain('Голос отключён');
    const actions = () => screen.getAllByRole('button', { name: 'Подключиться снова' });
    expect(actions()).toHaveLength(1);
    const user = userEvent.setup();
    const action = screen.getByRole('button', { name: 'Подключиться снова' });
    await user.click(action);
    await user.click(action);
    await vi.waitFor(() => expect(media).toHaveBeenCalledOnce());
    expect(action.hasAttribute('disabled')).toBe(true);
    expect(commands).toEqual(['leave', 'join']);
    expect(join).toHaveBeenCalledWith(expect.objectContaining(member));

    firstMedia.reject(new ApiError('Refused', 403, { code: 'invalid_session' }));
    await vi.waitFor(() => expect(action.hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('status').textContent).toContain('Голос отключён');
    expect(roomClientState.joined).toBe(false);
    expect(commands).toEqual(['leave', 'join', 'leave']);
    expect(shownToast).not.toHaveBeenCalled();
    expect(voiceLostCue).toHaveBeenCalledTimes(2);

    await user.click(action);
    await vi.waitFor(() => expect(roomClientState.joined).toBe(true));
    expect(screen.queryByText('Голос отключён')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подключиться снова' })).toBeNull();
    expect(page.screen).toBe('room');
    expect(router.currentRoute.value.path).toBe('/r/abc123');

    // Eviction while the manual retry is pending must make its late SDK completion inert.
    const cancelledMedia = Promise.withResolvers<boolean>();
    media.mockReturnValueOnce(cancelledMedia.promise);
    recovery.notifyLiveKitDisconnected();
    recovery.notifyRoomSnapshotApplied({ appEpoch: realtime.getConnectionEpoch(), active: true, hasLocalPeer: true });
    await user.click(await screen.findByRole('button', { name: 'Подключиться снова' }));
    await vi.waitFor(() => expect(media).toHaveBeenCalledTimes(3));
    expect(roomEvents.size).toBe(1);
    for (const handler of roomEvents)
      handler({ type: 'room.kicked', payload: { roomId: member.roomId, peerId: member.peerId } });
    expect(page.screen).toBe('moderation');
    roomClientState.roomId = 'other-room';
    cancelledMedia.resolve(true);
    recovery.notifyRoomAppConnection(true, realtime.getConnectionEpoch() + 1);
    await nextTick();
    expect(roomClientState.joined).toBe(false);
    expect(screen.queryByText('Голос отключён')).toBeNull();
    expect(voiceLostCue).toHaveBeenCalledTimes(3);
  } finally {
    leaveRoom();
    recovery.setRoomRecoveryLiveKitAdapter(null);
    vi.restoreAllMocks();
  }
});
