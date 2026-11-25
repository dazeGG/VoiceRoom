import { render, screen, fireEvent, within } from '@testing-library/vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CallAnswer, CallBootstrap, CallIncoming, CallSnapshot } from '@voiceroom/shared/contracts/rings';
import { Button, Dialog } from '@voiceroom/ui-kit/components';
import IncomingCallStack from '@/features/friend-call/IncomingCallStack.vue';
import FriendCallView from '@/features/friend-call/FriendCallView.vue';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { useCallEntry } from '@/features/friend-call/use-call-entry';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import { useToastsStore } from '@/features/home/model/toasts.store';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket';
import { stubFetch, type Reply } from '../fixtures/fetch';
import { authUser } from '../fixtures/users';
import { stubOverlayDom } from '../helpers/overlay-dom';

const muteRinger = vi.hoisted(() => vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {}));
vi.mock('@/features/friend-call/call-ringer', () => ({ ringOnThisDevice: muteRinger }));

const self = authUser({ id: 'me', displayName: 'Я' });
const ada = authUser({ id: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', displayName: 'Боб' });
const firstId = '52bc51a6-b4f9-4149-bc0b-c3aced36e223';
const secondId = '7e20ca65-2e98-4ed5-a428-2558e348650c';
const seatToken = 'a99357f4-dad9-4a77-9ff4-bf139989e489';
const now = 1_800_000_000_000;
const bootstrap = (data: Partial<CallBootstrap> = {}): CallBootstrap => ({
  ok: true,
  enabled: true,
  activeCalls: [],
  incoming: [],
  missed: [],
  serverNow: Date.now(),
  ...data
});

function snapshot(data: Partial<CallSnapshot> = {}): CallSnapshot {
  const { id, displayName, avatarColorKey, avatarAccent, avatarUrl } = self;
  return {
    id: firstId,
    caller: { id, displayName, avatarColorKey, avatarAccent, avatarUrl },
    recipient: ada,
    attempt: 1,
    attemptInviterUserId: self.id,
    revision: 1,
    phase: 'ringing',
    attemptResult: 'pending',
    startedAt: now,
    firstConnectedAt: null,
    endedAt: null,
    durationMs: 0,
    endReason: null,
    endedByUserId: null,
    serverNow: Date.now(),
    ringingExpiresAt: now + 45_000,
    aloneDeadline: now + 300_000,
    messageId: 'dm-call',
    allowedActions: ['leave'],
    ...data
  };
}

function incoming(data: Partial<CallIncoming> = {}): CallIncoming {
  return {
    callId: firstId,
    attempt: 1,
    revision: 1,
    fromUser: ada,
    ringingExpiresAt: now + 45_000,
    serverNow: Date.now(),
    ...data
  };
}

function answer(call: CallSnapshot): CallAnswer {
  return {
    ok: true,
    disposition: 'start',
    call,
    voiceAdmission: { roomId: 'opaque-room', peerId: 'private-seat', seatToken }
  };
}

let pinia: Pinia;
let calls: ReturnType<typeof useFriendCallStore>;
let stop: (() => void) | undefined;
const prepareVoice = vi.fn(async () => {});
const openCall = vi.fn<(id: string) => void>();
const closeCall = vi.fn<(id: string, peerId: string) => void>();
const flush = () => vi.advanceTimersByTimeAsync(0);
const realtimeState = (socket: FakeWebSocket, call: CallSnapshot) =>
  socket.receive({ type: 'call.state', payload: { call } });
const realtimeIncoming = (socket: FakeWebSocket, payload: CallIncoming) =>
  socket.receive({ type: 'call.incoming', payload });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  pinia = createPinia();
  setActivePinia(pinia);
  calls = useFriendCallStore(pinia);
  localStorage.clear();
  stubOverlayDom();
  installFakeWebSocket();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function start(routes: Record<string, Reply> = {}) {
  const fetch = stubFetch({ '/api/call-rings': { body: bootstrap() }, ...routes });
  stop = calls.startSession(self.id, { prepareVoice, openCall, closeCall });
  const socket = FakeWebSocket.latest();
  socket.open();
  socket.receive({ type: 'ready', payload: { userId: self.id } });
  await flush();
  return { socket, ...fetch };
}

test.each([{ status: 404 }, { body: bootstrap({ enabled: false }) }])(
  'bootstrap gates the entry points when the route is disabled or missing (%j)',
  async (reply) => {
    await start({ '/api/call-rings': reply });
    const entry = useCallEntry(
      () => ada.id,
      () => true
    );
    expect(entry.value.visible).toBe(false);
  }
);

test('one entry model covers online, offline, room switch, an existing seat and a missing seat', async () => {
  const { socket } = await start({ 'POST /api/call-rings': { body: answer(snapshot()) } });
  const voice = useVoiceSessionStore(pinia);
  const online = ref(true);
  const entry = useCallEntry(
    () => ada.id,
    () => online.value
  );
  expect(entry.value).toMatchObject({ label: 'Позвонить', visible: true, disabled: false, description: undefined });
  online.value = false;
  expect(entry.value.description).toBe('Не в сети. Звонок придёт уведомлением');
  expect(entry.value.disabled).toBe(false);
  voice.roomId = 'Game night';
  expect(entry.value.description).toBe('Вы покинете «Game night» Не в сети. Звонок придёт уведомлением');
  await entry.value.open();
  expect(prepareVoice).toHaveBeenCalledOnce();
  expect(entry.value.label).toBe('Вернуться в звонок');
  expect(entry.value.description).toBeUndefined();
  await entry.value.open();
  expect(openCall.mock.calls).toEqual([[firstId], [firstId]]);

  realtimeState(socket, snapshot({ id: secondId, recipient: bob, phase: 'alone', allowedActions: ['join'] }));
  const join = useCallEntry(
    () => bob.id,
    () => true
  );
  expect(join.value).toMatchObject({ label: 'Присоединиться', menuLabel: 'Присоединиться к звонку' });
});

test('a failed start gives the localized retry and reuses the same request id', async () => {
  let requests = 0;
  const { calls: http } = await start({
    'POST /api/call-rings': () => (++requests === 1 ? { status: 503 } : { body: answer(snapshot()) })
  });
  await calls.dial(ada.id);
  const toasts = useToastsStore(pinia);
  const toast = toasts.items[0];
  expect(toast).toMatchObject({
    message: 'Не удалось позвонить',
    description: 'Проверьте подключение и попробуйте ещё раз'
  });
  toast?.actions?.[0]?.onClick(toast.id);
  await flush();
  const bodies = http.filter(({ method }) => method === 'POST').map(({ body }) => body);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(calls.voice?.callId).toBe(firstId);
});

test('stale frames cannot revive a terminal or expired attempt, and the next ready reconciles missing cards', async () => {
  const first = incoming();
  const second = incoming({ callId: secondId, fromUser: bob, ringingExpiresAt: now + 1_000 });
  const { socket, calls: http } = await start({
    '/api/call-rings': () => ({ body: bootstrap({ incoming: [first] }) })
  });
  expect(calls.incoming).toHaveLength(1);
  realtimeIncoming(socket, second);
  realtimeState(
    socket,
    snapshot({ revision: 3, phase: 'closed', attemptResult: 'declined', endedAt: now, endReason: 'declined' })
  );
  realtimeIncoming(socket, { ...first, revision: 2 });
  expect(calls.incoming.map(({ callId }) => callId)).toEqual([secondId]);
  await vi.advanceTimersByTimeAsync(1_000);
  realtimeIncoming(socket, { ...second, revision: 3 });
  expect(calls.incoming).toHaveLength(0);
  realtimeIncoming(socket, incoming({ callId: secondId, fromUser: bob, attempt: 2, revision: 4 }));
  expect(calls.incoming).toHaveLength(1);
  socket.serverClose(1006);
  await vi.advanceTimersByTimeAsync(501);
  const reconnected = FakeWebSocket.latest();
  reconnected.open();
  reconnected.receive({ type: 'ready', payload: { userId: self.id } });
  await flush();
  expect(http.filter(({ url }) => url === '/api/call-rings')).toHaveLength(3);
  expect(calls.incoming).toHaveLength(0);
});

test('the stack is keyboard reachable inside a modal, keeps its other card after accept, and stops muted or expired audio', async () => {
  const first = incoming({ ringingExpiresAt: now + 2_000 });
  const second = incoming({ callId: secondId, fromUser: bob, ringingExpiresAt: now + 3_000 });
  const { socket } = await start({
    [`POST /api/call-rings/${firstId}/actions`]: {
      body: answer(
        snapshot({ caller: ada, recipient: self, revision: 2, phase: 'connecting', attemptResult: 'accepted' })
      )
    },
    [`/api/call-rings/${secondId}`]: { status: 404, body: { ok: false, code: 'call_not_found' } }
  });
  render(
    defineComponent(() => () => [
      h(Dialog, { open: true, title: 'Settings' }, () => h(Button, {}, () => 'Keep editing')),
      h(IncomingCallStack)
    ]),
    { global: { plugins: [pinia] } }
  );
  await flush();
  const modal = screen.getByRole('dialog', { name: 'Settings' });
  const task = within(modal).getByRole('button', { name: 'Keep editing' });
  task.focus();
  realtimeIncoming(socket, first);
  realtimeIncoming(socket, second);
  await flush();
  expect(document.activeElement).toBe(task);
  expect(within(modal).getByRole('button', { name: 'Принять: Боб' })).toBeTruthy();
  const ringer = muteRinger.mock.calls[0]?.[0];
  expect(ringer?.aborted).toBe(false);
  await fireEvent.click(within(modal).getByRole('button', { name: 'Выключить звук звонка' }));
  expect(ringer?.aborted).toBe(true);
  expect(calls.incoming).toHaveLength(2);
  expect(within(modal).getByRole('button', { name: 'Включить звук звонка', pressed: true })).toBeTruthy();
  await fireEvent.click(within(modal).getByRole('button', { name: 'Принять' }));
  await flush();
  expect(calls.voice?.callId).toBe(firstId);
  expect(within(modal).getByRole('region', { name: 'Боб звонит вам' })).toBeTruthy();
  expect(within(modal).queryByRole('region', { name: 'Ада звонит вам' })).toBeNull();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(within(modal).queryByRole('region', { name: 'Боб звонит вам' })).toBeNull();
  expect(muteRinger.mock.lastCall?.[0].aborted).toBe(true);
});

test('the call view goes from ringing to a countdown, re-rings, and gives a decline two seconds before returning', async () => {
  const initial = snapshot();
  const { socket } = await start({
    'POST /api/call-rings': { body: answer(initial) },
    [`/api/call-rings/${firstId}`]: {
      body: {
        ok: true,
        call: snapshot({
          revision: 2,
          phase: 'alone',
          attemptResult: 'no_answer',
          allowedActions: ['leave', 're-ring']
        })
      }
    },
    [`POST /api/call-rings/${firstId}/actions`]: () => ({
      body: {
        ok: true,
        disposition: 'open',
        call: snapshot({ revision: 3, attempt: 2, ringingExpiresAt: Date.now() + 45_000 })
      }
    })
  });
  await calls.dial(ada.id);
  render(
    defineComponent(() => () => {
      const record = calls.record(firstId);
      return record ? h(FriendCallView, record) : null;
    }),
    { global: { plugins: [pinia] } }
  );
  expect(screen.getByRole('region', { name: 'Звонок: Ада' })).toBeTruthy();
  expect(screen.getByText('Звоним…', { selector: '[role=status] p' })).toBeTruthy();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(screen.getByRole('timer').textContent).toContain('4:15');
  await fireEvent.click(screen.getByRole('button', { name: 'Позвонить снова' }));
  await flush();
  expect(screen.getByText('Звоним…', { selector: '[role=status] p' })).toBeTruthy();
  realtimeState(
    socket,
    snapshot({
      revision: 4,
      attempt: 2,
      phase: 'closed',
      attemptResult: 'declined',
      endReason: 'declined',
      endedByUserId: ada.id,
      endedAt: Date.now()
    })
  );
  await nextTick();
  expect(screen.getByText('Возвращаемся в личные сообщения…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull();
  await vi.advanceTimersByTimeAsync(1_999);
  expect(closeCall).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(closeCall).toHaveBeenCalledWith(firstId, ada.id);
});

test('a departed peer has a stable tile and an alone deadline', async () => {
  const call = snapshot({
    firstConnectedAt: now - 90_000,
    phase: 'alone',
    attemptResult: 'accepted',
    aloneDeadline: now + 300_000,
    allowedActions: ['leave', 're-ring'],
    seats: [
      { userId: self.id, status: 'present', reconnectUntil: null },
      { userId: ada.id, status: 'absent', reconnectUntil: null }
    ]
  });
  await start();
  const reconnecting: CallSnapshot = {
    ...call,
    phase: 'connecting',
    aloneDeadline: null,
    seats: [
      { userId: self.id, status: 'present', reconnectUntil: null },
      { userId: ada.id, status: 'reconnecting', reconnectUntil: now + 30_000 }
    ]
  };
  const view = render(FriendCallView, { props: { call: reconnecting, offset: 0 }, global: { plugins: [pinia] } });
  expect(screen.getByRole('timer').textContent).toContain('01:30');
  expect(screen.queryByText('Ада покидает звонок')).toBeNull();
  await view.rerender({ call });
  expect(screen.getByText('Ада покидает звонок')).toBeTruthy();
  expect(screen.getByText('Не в звонке')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(screen.getAllByRole('timer').some((timer) => timer.textContent?.includes('4:00'))).toBe(true);
});
