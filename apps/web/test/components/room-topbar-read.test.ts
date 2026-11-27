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
import { getAppRealtime } from '@/api/realtime';
import { webCallTransport } from '@/features/room/adapters/web-call-transport';
import { buildServerEnvelope, buildServerErrorEnvelope } from '@voiceroom/shared/realtime';
import type { ReplacementOutcome } from '@voiceroom/call/engine/recovery/realtime-recovery';
import {
  cancelRoomRecovery,
  notifyLiveKitDisconnected,
  notifyLiveKitReconciled,
  notifyRoomSnapshotApplied,
  setRoomRecoveryLiveKitAdapter,
  startRoomRecovery,
  subscribeRoomRecoveryTransitions
} from '@voiceroom/call/engine/recovery/room-recovery';
import { leaveRoom } from '@voiceroom/call/engine/room/room';
import * as cues from '@voiceroom/call/engine/media/cues';
import * as devices from '@voiceroom/call/engine/ui/devices';
import * as livekit from '@voiceroom/call/engine/services/livekit-service';
import { lobbyRoom, roomStatus } from '../fixtures/answers';
import { installFakeWebSocket } from '../fixtures/fake-websocket';
import { stubFetch } from '../fixtures/fetch.ts';
import { participant } from '../fixtures/participant.ts';
import { renderWithApp } from '../helpers/render.ts';
import { installWebCallPortsForTest } from '../helpers/call-ports';

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

test('the room reconnect button leaves then joins once, stays after failure and clears on success', async () => {
  const { pinia, router } = await renderWithApp(RoomTopbar, { route: '/r/abc123' });
  await installWebCallPortsForTest();
  const sockets = installFakeWebSocket();
  const page = usePageStore(pinia);
  const member = { roomId: 'abc123', peerId: 'peer-resync', sessionToken: 's'.repeat(32), name: 'Retry peer' };
  page.screen = 'room';
  Object.assign(roomClientState, { ...member, joined: true, voiceRecoveryFailed: true });
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: member.roomId }) } });
  const unsubscribe = getAppRealtime().subscribe(() => {});
  const socket = sockets.latest();
  socket.open();
  webCallTransport.realtime.join(member);
  const commands = () => socket.sent.filter(({ type }) => type === 'room.leave' || type === 'room.join').slice(1);

  try {
    expect((await screen.findByRole('status')).textContent).toContain('Голос отключён');
    const action = () => screen.getByRole('button', { name: 'Подключиться снова' });
    const firstMedia = Promise.withResolvers<boolean>();
    const media = vi
      .spyOn(livekit, 'connectLiveKitRoom')
      .mockReturnValueOnce(firstMedia.promise)
      .mockResolvedValue(true);
    vi.spyOn(devices, 'acquireMicrophoneForJoin').mockResolvedValue(null);
    const cue = vi.spyOn(cues, 'playVoiceLostCue').mockImplementation(() => {});
    const user = userEvent.setup();

    await user.click(action());
    await user.click(action());
    await vi.waitFor(() => expect(media).toHaveBeenCalledOnce());
    expect(action().hasAttribute('disabled')).toBe(true);
    expect(commands().map(({ type }) => type)).toEqual(['room.leave', 'room.join']);
    expect(commands().at(-1)?.payload).toEqual(
      expect.objectContaining({ roomId: member.roomId, peerId: member.peerId, sessionToken: member.sessionToken })
    );

    firstMedia.reject(new Error('Could not connect voice'));
    await vi.waitFor(() => expect(action().hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('status').textContent).toContain('Голос отключён');
    expect(roomClientState.joined).toBe(false);
    expect(cue).toHaveBeenCalledOnce();

    const refusedMedia = Promise.withResolvers<boolean>();
    media.mockReturnValueOnce(refusedMedia.promise);
    await user.click(action());
    await vi.waitFor(() => expect(media).toHaveBeenCalledTimes(2));
    socket.receive({ type: 'room.full', payload: { roomId: member.roomId, maxRoomPeers: 10 } });
    await nextTick();
    expect(action().hasAttribute('disabled')).toBe(false);
    expect(cue).toHaveBeenCalledTimes(2);
    refusedMedia.resolve(false);

    await user.click(action());
    await vi.waitFor(() => expect(roomClientState.joined).toBe(true));
    expect(screen.queryByText('Голос отключён')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подключиться снова' })).toBeNull();
    expect(page.screen).toBe('room');
    expect(router.currentRoute.value.path).toBe('/r/abc123');
    expect(cue).toHaveBeenCalledTimes(2);

    const cancelledMedia = Promise.withResolvers<boolean>();
    media.mockReturnValueOnce(cancelledMedia.promise);
    roomClientState.voiceRecoveryFailed = true;
    await user.click(await screen.findByRole('button', { name: 'Подключиться снова' }));
    await vi.waitFor(() => expect(media).toHaveBeenCalledTimes(4));
    socket.receive({ type: 'room.kicked', payload: { roomId: member.roomId, peerId: member.peerId } });
    cancelledMedia.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.screen).toBe('moderation');
    expect(roomClientState.joined).toBe(false);
    expect(roomClientState.voiceRecoveryFailed).toBe(false);
    expect(cue).toHaveBeenCalledTimes(2);
  } finally {
    leaveRoom();
    Object.assign(roomClientState, { voiceRecoveryFailed: false });
    unsubscribe();
    vi.restoreAllMocks();
  }
});

test('a late resync snapshot can start a replacement that clears the callout after a newer refusal', async () => {
  const { pinia } = await renderWithApp(RoomTopbar, { route: '/r/abc123' });
  await installWebCallPortsForTest();
  usePageStore(pinia).screen = 'room';
  const member = { roomId: 'abc123', peerId: 'peer-resync', sessionToken: 's'.repeat(32), name: 'Retry peer' };
  Object.assign(roomClientState, { ...member, joined: true, outputMuted: true });
  await nextTick();
  vi.useFakeTimers();
  const sockets = installFakeWebSocket();
  const { realtime } = webCallTransport;
  const unsubscribe = realtime.subscribeRoom(member.roomId, (event) => {
    if (event.type !== 'room.snapshot') return;
    notifyRoomSnapshotApplied({
      appEpoch: realtime.getConnectionEpoch(),
      active: event.payload.mode === 'active',
      hasLocalPeer: event.payload.peers.some(({ id }) => id === member.peerId)
    });
  });
  const socket = sockets.latest();
  socket.open();
  realtime.join(member);
  const replacement = Promise.withResolvers<ReplacementOutcome>();
  const attemptFreshReplacement = vi.fn(() => replacement.promise);
  setRoomRecoveryLiveKitAdapter({ attemptFreshReplacement });
  const onTransition = vi.fn<(event: { phase: string }) => void>();
  const unsubscribeTransitions = subscribeRoomRecoveryTransitions(onTransition);
  const snapshot = (id?: string) =>
    socket.receive(
      buildServerEnvelope(
        'room.snapshot',
        {
          mode: 'active',
          roomId: member.roomId,
          room: lobbyRoom({ roomId: member.roomId }),
          peers: [
            {
              id: member.peerId,
              name: member.name,
              serverMuted: false,
              accountUserId: '',
              avatarAccent: '',
              avatarColorKey: '',
              avatarUrl: null
            }
          ],
          recentMessages: [],
          voiceActiveSince: null
        },
        id
      )
    );
  const lastJoinId = () => socket.sent.findLast(({ type }) => type === 'room.join')?.id;

  try {
    startRoomRecovery(realtime.getConnectionEpoch(), realtime.isConnected());
    snapshot();
    notifyLiveKitReconciled();
    notifyLiveKitDisconnected();
    const first = lastJoinId();
    expect(first).toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = lastJoinId();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    snapshot(first);
    expect(attemptFreshReplacement).toHaveBeenCalledOnce();
    socket.receive(buildServerErrorEnvelope('server_mute_unavailable', '', second));
    await nextTick();
    expect(roomClientState.voiceRecoveryFailed).toBe(true);
    expect(screen.getByRole('button', { name: 'Подключиться снова' })).toBeTruthy();

    replacement.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(onTransition.mock.lastCall?.[0].phase).toBe('healthy');
    expect(roomClientState.voiceRecoveryFailed).toBe(false);
    expect(screen.queryByText('Голос отключён')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подключиться снова' })).toBeNull();
    expect(attemptFreshReplacement).toHaveBeenCalledOnce();
  } finally {
    cancelRoomRecovery();
    setRoomRecoveryLiveKitAdapter(null);
    realtime.leave(member);
    unsubscribeTransitions();
    unsubscribe();
    Object.assign(roomClientState, { joined: false, outputMuted: false });
    vi.useRealTimers();
  }
});
