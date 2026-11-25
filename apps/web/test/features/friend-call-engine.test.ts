import { fireEvent, screen, within } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { CallAnswer, CallBootstrap } from '@voiceroom/shared/contracts/rings';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import { useSessionStore } from '@/features/auth/session.store';
import FriendCallHost from '@/features/friend-call/FriendCallHost.vue';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import LobbyPage from '@/features/home/LobbyPage.vue';
import { useToastsStore } from '@/features/home/model/toasts.store';
import { APP_HOME } from '@/shared/app-home';
import { stubFetch } from '../fixtures/fetch';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket';
import { authUser } from '../fixtures/users';
import { installWebCallPortsForTest } from '../helpers/call-ports';
import { renderWithApp } from '../helpers/render';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { stubMatchMedia } from '../helpers/match-media';
import { stubSplitterLayout } from '../helpers/splitter-layout';

const connect = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@voiceroom/call/engine/services/microphone-service', async (original) => ({
  ...(await original<object>()),
  openLocalMicrophone: vi.fn(async () => {
    throw new DOMException('Permission denied', 'NotAllowedError');
  })
}));
vi.mock('@voiceroom/call/engine/services/livekit-service', async (original) => ({
  ...(await original<object>()),
  connectLiveKitRoom: connect,
  syncRemoteVideoVisibility: vi.fn()
}));

test('browsing away and opening the DM from the rail retains one voice join with microphone permission denied', async () => {
  installFakeWebSocket();
  stubOverlayDom();
  stubMatchMedia();
  stubSplitterLayout();
  window.history.replaceState(null, '', APP_HOME);
  onTestFinished(() => window.history.replaceState(null, '', APP_HOME));
  const self = authUser();
  const peer = authUser({ id: 'ada', displayName: 'Ада' });
  const now = Date.now();
  const rooms: CallBootstrap = { ok: true, enabled: true, activeCalls: [], incoming: [], missed: [], serverNow: now };
  const outgoing: CallAnswer = {
    ok: true,
    disposition: 'start',
    call: {
      id: 'add6d72c-141d-4023-b41b-17cdf25526ef',
      caller: self,
      recipient: peer,
      attempt: 1,
      attemptInviterUserId: self.id,
      phase: 'ringing',
      attemptResult: 'pending',
      revision: 1,
      ringingExpiresAt: now + 45_000,
      aloneDeadline: now + 300_000,
      startedAt: now,
      firstConnectedAt: null,
      endedAt: null,
      durationMs: 0,
      endReason: null,
      endedByUserId: null,
      allowedActions: ['leave'],
      serverNow: now,
      messageId: 'voice-message'
    },
    voiceAdmission: {
      roomId: 'opaque-room',
      peerId: 'seat-local',
      seatToken: 'a99357f4-dad9-4a77-9ff4-bf139989e489'
    }
  };
  const requests = stubFetch({
    '/api/call-rings': { body: rooms },
    'POST /api/call-rings': { body: outgoing }
  });

  const App = defineComponent(() => {
    const session = useSessionStore();
    return () => [h(FriendCallHost), session.user ? h(LobbyPage, { user: session.user, loggingOut: false }) : null];
  });
  const page = await renderWithApp(App, { route: APP_HOME });
  await installWebCallPortsForTest();
  const session = useSessionStore(page.pinia);
  const calls = useFriendCallStore(page.pinia);
  const voice = useVoiceSessionStore(page.pinia);
  session.setUser(self);
  const socket = FakeWebSocket.latest();
  socket.open();
  socket.receive({ type: 'ready', payload: { userId: self.id } });
  await vi.waitFor(() => expect(calls.enabled).toBe(true));
  await calls.dial(peer.id);
  await vi.waitFor(() => expect(voice.roomId).toBe('opaque-room'));
  expect(page.router.currentRoute.value.path).toBe(APP_HOME);
  expect(page.router.currentRoute.value.query).toEqual({ dm: peer.id });
  const dm = () => screen.getByRole('region', { name: 'Личные сообщения' });
  expect(within(dm()).getByRole('region', { name: 'Звонок: Ада' })).toBeTruthy();
  expect(voice.muted).toBe(true);
  const dock = within(dm()).getByRole('group', { name: 'Управление звонком' });
  expect(within(dock).getByRole('button', { name: 'Завершить' })).toBeTruthy();
  expect(useToastsStore(page.pinia).items).toContainEqual(
    expect.objectContaining({
      message: 'Не удалось включить микрофон',
      description: 'Разрешите доступ к микрофону в браузере'
    })
  );
  expect(requests.calls.some(({ url }) => url === '/api/rooms/opaque-room')).toBe(false);
  expect(socket.sent.map(({ type }) => type)).toContain('call.voice.join');
  expect(socket.sent.map(({ type }) => type)).not.toContain('room.join');

  await fireEvent.click(screen.getByRole('button', { name: /VoiceRoom/ }));
  await vi.waitFor(() => expect(page.router.currentRoute.value.query).toEqual({}));
  expect(screen.queryByRole('region', { name: 'Звонок: Ада' })).toBeNull();
  expect(voice.roomId).toBe('opaque-room');
  const rail = screen.getByRole('region', { name: 'Активный звонок' });
  await fireEvent.click(within(rail).getByRole('button', { name: 'Вернуться в звонок' }));
  const reopened = await screen.findByRole('region', { name: 'Личные сообщения' });
  expect(within(reopened).getByRole('region', { name: 'Звонок: Ада' })).toBeTruthy();
  expect(page.router.currentRoute.value.query).toEqual({ dm: peer.id });
  expect(socket.sent.filter(({ type }) => type === 'call.voice.join')).toHaveLength(1);
  expect(connect).toHaveBeenCalledOnce();
  expect(voice.roomId).toBe('opaque-room');
  page.unmount();
  expect(voice.roomId).toBeNull();
});
