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
import * as cues from '@voiceroom/call/engine/media/cues';
import * as devices from '@voiceroom/call/engine/ui/devices';
import * as livekit from '@voiceroom/call/engine/services/livekit-service';
import * as toast from '@voiceroom/call/engine/ui/toast';
import { stubFetch } from '../fixtures/fetch.ts';
import { lobbyRoom, roomStatus } from '../fixtures/answers.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { getAppRealtime } from '@/api/realtime';
import { participant } from '../fixtures/participant.ts';
import { renderWithApp } from '../helpers/render.ts';
import { installWebCallPortsForTest } from '../helpers/call-ports.ts';
import * as recovery from '@voiceroom/call/engine/recovery/room-recovery';

const retryMember = { roomId: 'abc123', peerId: 'peer-resync', sessionToken: 's'.repeat(32), name: 'Retry peer' };
const activeSnapshot = {
  mode: 'active' as const,
  roomId: retryMember.roomId,
  room: lobbyRoom({ roomId: retryMember.roomId }),
  peers: [
    {
      id: retryMember.peerId,
      name: retryMember.name,
      serverMuted: false,
      accountUserId: '',
      avatarColorKey: '',
      avatarAccent: null,
      avatarUrl: null
    }
  ],
  recentMessages: [],
  voiceActiveSince: null
};

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

async function setupManualReconnect() {
  const sockets = installFakeWebSocket();
  const { pinia, router } = await renderWithApp(RoomTopbar, { route: '/r/abc123' });
  await installWebCallPortsForTest();
  const page = usePageStore(pinia);
  page.screen = 'room';
  Object.assign(roomClientState, { ...retryMember, joined: true, voiceRecoveryFailed: true });
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: retryMember.roomId }) } });
  vi.spyOn(devices, 'acquireMicrophoneForJoin').mockResolvedValue(null);
  const voiceLostCue = vi.spyOn(cues, 'playVoiceLostCue').mockImplementation(() => {});
  const unsubscribe = getAppRealtime().subscribe(() => {});
  const first = sockets.latest();
  first.open();
  webCallTransport.realtime.join(retryMember);
  const join = vi.spyOn(webCallTransport.realtime, 'join');
  const action = await screen.findByRole('button', { name: 'Подключиться снова' });
  return { action, first, join, page, router, sockets, unsubscribe, voiceLostCue };
}

test.each(['open', 'closed'])(
  'manual voice admission waits for the fresh join with the app socket %s',
  async (socketState) => {
    const { action, first, join, sockets, unsubscribe } = await setupManualReconnect();
    const previousJoin = first.sent.at(-1)?.id;
    const pendingToken = Promise.withResolvers<never>();
    const token = vi.spyOn(webCallTransport, 'requestLiveKitToken').mockReturnValue(pendingToken.promise);
    try {
      if (socketState === 'closed') first.serverClose(1006);
      await userEvent.click(action);
      await vi.waitFor(() => expect(join).toHaveBeenCalledOnce());
      expect.soft(token).not.toHaveBeenCalled();

      const manualSocket = sockets.latest();
      if (socketState === 'closed') manualSocket.open();
      const commands = manualSocket.sent
        .filter(({ type }) => type === 'room.leave' || type === 'room.join')
        .slice(socketState === 'open' ? 1 : 0);
      expect.soft(commands.map(({ type }) => type)).toEqual(['room.leave', 'room.join']);
      const freshJoin = commands.at(-1)?.id;
      expect(freshJoin).toBeDefined();
      expect(freshJoin).not.toBe(previousJoin);
      // The server is still processing the leave. A stale acknowledgement, even with the
      // same member, cannot release admission while the fresh join waits behind it.
      manualSocket.receive({ type: 'room.snapshot', id: previousJoin, payload: activeSnapshot });
      manualSocket.receive({ type: 'room.snapshot', id: freshJoin, payload: { ...activeSnapshot, mode: 'preview' } });
      await nextTick();
      expect.soft(token).not.toHaveBeenCalled();
      manualSocket.receive({ type: 'room.snapshot', id: freshJoin, payload: activeSnapshot });
      await vi.waitFor(() =>
        expect(token).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            roomId: retryMember.roomId,
            peerId: retryMember.peerId,
            sessionToken: retryMember.sessionToken
          })
        )
      );
    } finally {
      leaveRoom();
      if (token.mock.calls.length) pendingToken.reject(new Error('Test call ended'));
      unsubscribe();
      vi.restoreAllMocks();
    }
  }
);

test.each([
  { type: 'room.full', payload: { roomId: retryMember.roomId, maxRoomPeers: 10 } },
  { type: 'server.full', payload: { roomId: retryMember.roomId, maxVoicePeers: 100 } }
])('manual voice join keeps the failure action after $type', async (refusal) => {
  const { action, first, join, page, router, unsubscribe } = await setupManualReconnect();
  const pendingToken = Promise.withResolvers<never>();
  const token = vi.spyOn(webCallTransport, 'requestLiveKitToken').mockReturnValue(pendingToken.promise);
  const shownToast = vi.spyOn(toast, 'showToast');
  try {
    await userEvent.click(action);
    await vi.waitFor(() => expect(join).toHaveBeenCalledOnce());
    first.receive(refusal);
    await nextTick();
    expect.soft(shownToast).not.toHaveBeenCalled();
    expect(page.screen).toBe('room');
    expect(router.currentRoute.value.path).toBe('/r/abc123');
    expect(screen.getByRole('status').textContent).toContain('Голос отключён');
    await vi.waitFor(() => expect(action.hasAttribute('disabled')).toBe(false));
    await userEvent.click(action);
    await vi.waitFor(() => expect(join).toHaveBeenCalledTimes(2));
    first.receive({ type: 'room.banned', payload: { roomId: retryMember.roomId, peerId: retryMember.peerId } });
    expect(page.screen).toBe('moderation');
    expect(roomClientState.moderationReason).toBe('banned');
  } finally {
    leaveRoom();
    if (token.mock.calls.length) pendingToken.reject(new Error('Test call ended'));
    unsubscribe();
    vi.restoreAllMocks();
  }
});

test('R7/R8: a visible reconnect action leaves and rejoins voice once and clears only on media success', async () => {
  const { action, first, join, page, router, unsubscribe, voiceLostCue } = await setupManualReconnect();
  const firstMedia = Promise.withResolvers<boolean>();
  const media = vi.spyOn(livekit, 'connectLiveKitRoom').mockReturnValueOnce(firstMedia.promise).mockResolvedValue(true);
  const shownToast = vi.spyOn(toast, 'showToast');
  const realtime = webCallTransport.realtime;
  const voiceCommands = () => first.sent.filter(({ type }) => type === 'room.leave' || type === 'room.join');
  const acknowledgeJoin = () => {
    const id = first.sent.findLast(({ type }) => type === 'room.join')?.id;
    expect(id).toBeDefined();
    first.receive({ type: 'room.snapshot', id, payload: activeSnapshot });
  };
  recovery.setRoomRecoveryLiveKitAdapter({
    attemptFreshReplacement: async () => ({ retryable: false, code: 'invalid_session' })
  });
  recovery.startRoomRecovery(realtime.getConnectionEpoch(), true);
  recovery.notifyLiveKitDisconnected();
  recovery.notifyRoomSnapshotApplied({ appEpoch: realtime.getConnectionEpoch(), active: true, hasLocalPeer: true });
  const initialCommands = voiceCommands().length;
  try {
    expect((await screen.findByRole('status')).textContent).toContain('Голос отключён');
    const actions = () => screen.getAllByRole('button', { name: 'Подключиться снова' });
    expect(actions()).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(action);
    await user.click(action);
    await vi.waitFor(() => expect(join).toHaveBeenCalledOnce());
    acknowledgeJoin();
    await vi.waitFor(() => expect(media).toHaveBeenCalledOnce());
    expect(action.hasAttribute('disabled')).toBe(true);
    expect(
      voiceCommands()
        .slice(initialCommands)
        .map(({ type }) => type)
    ).toEqual(['room.leave', 'room.join']);
    expect(join).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: retryMember.roomId,
        peerId: retryMember.peerId,
        sessionToken: retryMember.sessionToken
      })
    );

    firstMedia.reject(new ApiError('Refused', 403, { code: 'invalid_session' }));
    await vi.waitFor(() => expect(action.hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('status').textContent).toContain('Голос отключён');
    expect(roomClientState.joined).toBe(false);
    expect(
      voiceCommands()
        .slice(initialCommands)
        .map(({ type }) => type)
    ).toEqual(['room.leave', 'room.join', 'room.leave']);
    expect(shownToast).not.toHaveBeenCalled();
    expect(voiceLostCue).toHaveBeenCalledTimes(2);

    await user.click(action);
    await vi.waitFor(() => expect(join).toHaveBeenCalledTimes(2));
    acknowledgeJoin();
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
    await vi.waitFor(() => expect(join).toHaveBeenCalledTimes(3));
    acknowledgeJoin();
    await vi.waitFor(() => expect(media).toHaveBeenCalledTimes(3));
    first.receive({ type: 'room.kicked', payload: { roomId: retryMember.roomId, peerId: retryMember.peerId } });
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
    unsubscribe();
    recovery.setRoomRecoveryLiveKitAdapter(null);
    vi.restoreAllMocks();
  }
});
