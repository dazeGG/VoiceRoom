import { render, screen, fireEvent, within } from '@testing-library/vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  CallAnswer,
  CallBootstrap,
  CallIncoming,
  CallMissedUpdated,
  CallSnapshot,
  DirectMessageCall
} from '@voiceroom/shared/contracts/rings';
import { Button, Dialog } from '@voiceroom/ui-kit/components';
import IncomingCallStack from '@/features/friend-call/IncomingCallStack.vue';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { useCallEntry } from '@/features/friend-call/use-call-entry';
import { useScreenUiStore, useVoiceSessionStore } from '@voiceroom/call/engine';
import { state as callRuntime } from '@voiceroom/call/engine/core/room-runtime.store';
import { useToastsStore } from '@/features/home/model/toasts.store';
import { useLobbyStore } from '@/features/home/model/lobby.store';
import DmCallEvent from '@/features/home/components/lobby/dm/DmCallEvent.vue';
import DmView from '@/features/home/components/lobby/DmView.vue';
import Sidebar from '@/features/home/components/lobby/Sidebar.vue';
import VoiceCallWidget from '@/features/home/components/lobby/VoiceCallWidget.vue';
import { provideLobby } from '@/features/home/model/lobby-context';
import { usePortraitCallLayout } from '@/features/room/mobile-call-layout';
import { PORTRAIT_PHONE_QUERY } from '@/features/room/mobile-call-ui.store';
import { clockTime } from '@/shared/utils/date-format';
import { useLocaleStore } from '@/shared/i18n';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket';
import { stubFetch, type Reply } from '../fixtures/fetch';
import { authUser } from '../fixtures/users';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { stubSplitterLayout } from '../helpers/splitter-layout';

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
const flush = () => vi.advanceTimersByTimeAsync(0);
const realtimeState = (socket: FakeWebSocket, call: CallSnapshot) =>
  socket.receive({ type: 'call.state', payload: { call } });
const realtimeIncoming = (socket: FakeWebSocket, payload: CallIncoming) =>
  socket.receive({ type: 'call.incoming', payload });

function projection(data: Partial<DirectMessageCall> = {}): DirectMessageCall {
  return {
    callId: firstId,
    revision: 1,
    outcome: 'live',
    startedAt: now,
    firstConnectedAt: null,
    endedAt: null,
    durationMs: 0,
    endReason: null,
    endedByUserId: null,
    missedAt: null,
    missedRevision: null,
    missedSeenRevision: null,
    ...data
  };
}

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
  stop = calls.startSession(self.id, { prepareVoice, openCall });
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
  expect(openCall.mock.calls).toEqual([[ada.id], [ada.id]]);

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

function mountDm(lobby = useLobbyStore(pinia)) {
  stubSplitterLayout();
  return render(
    defineComponent(() => {
      provideLobby(lobby);
      const portrait = usePortraitCallLayout();
      return () => h(DmView, { self, portrait: portrait.value });
    }),
    { global: { plugins: [pinia] } }
  );
}

function selectPeer(lobby: ReturnType<typeof useLobbyStore>, peer = ada): void {
  lobby.selectedFriendId = peer.id;
  lobby.thread.peer = peer;
  lobby.view = 'dm';
}

const dm = () => screen.getByRole('region', { name: 'Личные сообщения' });
const stage = () => within(dm()).getByRole('region', { name: 'Звонок: Ада' });
const splitter = () => screen.getByRole('separator', { name: 'Высота звонка' });
const composer = () => within(dm()).getByRole('textbox', { name: /Написать сообщение|^$/ });

test('the DM stage counts down, re-rings and closes on decline while the conversation stays open', async () => {
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
  const lobby = useLobbyStore(pinia);
  selectPeer(lobby);
  mountDm(lobby);
  expect(stage()).toBeTruthy();
  const field = composer();
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
  expect(within(stage()).getByRole('status').textContent).toContain('Звонок отклонён');
  expect(within(stage()).queryByRole('button', { name: 'Завершить' })).toBeNull();
  await vi.advanceTimersByTimeAsync(800);
  expect(screen.queryByRole('region', { name: 'Звонок: Ада' })).toBeNull();
  expect(composer()).toBe(field);
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
  const reconnecting: CallSnapshot = {
    ...call,
    phase: 'connecting',
    aloneDeadline: null,
    seats: [
      { userId: self.id, status: 'present', reconnectUntil: null },
      { userId: ada.id, status: 'reconnecting', reconnectUntil: now + 30_000 }
    ]
  };
  const { socket } = await start({ 'POST /api/call-rings': { body: answer(reconnecting) } });
  await calls.dial(ada.id);
  const lobby = useLobbyStore(pinia);
  selectPeer(lobby);
  mountDm(lobby);
  expect(within(dm()).getByText('Переподключаемся…')).toBeTruthy();
  expect(screen.queryByText('Ада покидает звонок')).toBeNull();
  realtimeState(socket, { ...call, revision: 2 });
  await nextTick();
  expect(screen.getAllByRole('timer').some((timer) => timer.textContent?.includes('01:30'))).toBe(true);
  expect(screen.getByText('Ада покидает звонок')).toBeTruthy();
  expect(screen.getByText('Не в звонке')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(screen.getAllByRole('timer').some((timer) => timer.textContent?.includes('4:00'))).toBe(true);
});

test('the rail keeps return, microphone, output and end independently operable as the call connects', async () => {
  const voice = {
    roomName: ada.displayName,
    avatarUrl: null,
    muted: false,
    deafened: false,
    open: vi.fn(),
    toggleMic: vi.fn(),
    toggleDeafen: vi.fn(),
    leave: vi.fn()
  };
  const friendCall = {
    peerId: ada.id,
    avatarColorKey: 'rose',
    avatarAccent: null,
    since: now,
    controlsReady: false
  };
  const view = render(VoiceCallWidget, {
    props: { voice: { ...voice, friendCall: { ...friendCall, status: 'ringing' } } },
    global: { plugins: [pinia] }
  });
  const rail = within(screen.getByRole('region', { name: 'Активный звонок' }));
  const open = rail.getByRole('button', { name: 'Вернуться в звонок', description: /Звоним/ });
  expect(rail.getByRole('button', { name: 'Выключить микрофон' })).toHaveProperty('disabled', true);
  expect(rail.getByRole('button', { name: 'Завершить' })).toHaveProperty('disabled', false);
  await vi.advanceTimersByTimeAsync(1);
  await fireEvent.click(open);
  expect(voice.open).toHaveBeenCalledOnce();
  await view.rerender({
    voice: { ...voice, friendCall: { ...friendCall, status: 'connected', controlsReady: true } }
  });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(rail.getByText('В звонке')).toBeTruthy();
  expect(rail.getByRole('timer').textContent).toBe('00:02');
  for (const [label, action] of [
    ['Выключить микрофон', voice.toggleMic],
    ['Заглушить звук', voice.toggleDeafen],
    ['Завершить', voice.leave]
  ] as const) {
    await fireEvent.click(rail.getByRole('button', { name: label }));
    expect(action).toHaveBeenCalledOnce();
  }
  expect(voice.open).toHaveBeenCalledOnce();
  await view.rerender({ voice });
  const roomRail = within(screen.getByRole('region', { name: 'Активный голос' }));
  expect(roomRail.getByRole('button', { name: 'Выйти из голосовой комнаты' })).toBeTruthy();
  expect(roomRail.getByText('Подключено')).toBeTruthy();
});

test.each([
  ['live', true, false, /Идёт звонок/, null],
  ['live', false, false, /Идёт звонок/, null],
  ['live', true, true, /Идёт звонок/, null],
  ['live', false, true, /Пропущенный звонок/, null],
  ['completed', true, false, /Исходящий звонок · 1 ч 05 мин/, null],
  ['completed', false, false, /Входящий звонок · 1 ч 05 мин/, null],
  ['no_answer', true, false, /Нет ответа/, 'Исходящий'],
  ['no_answer', false, false, /Пропущенный звонок/, null],
  ['cancelled', true, false, /Нет ответа/, 'Исходящий'],
  ['cancelled', false, false, /Пропущенный звонок/, null],
  ['declined', true, false, /Звонок отклонён/, 'Исходящий'],
  ['declined', false, false, /Звонок отклонён/, 'Входящий']
] as const)('renders %s relative to the viewer (caller=%s, missed=%s)', (outcome, fromMe, missed, title, direction) => {
  render(DmCallEvent, {
    props: {
      projection: projection({ outcome, missedAt: missed ? now : null, durationMs: 65 * 60_000 }),
      createdAt: now - 1_000,
      peerId: ada.id,
      peerName: ada.displayName,
      fromMe
    },
    global: { plugins: [pinia] }
  });
  const article = screen.getByRole('article');
  const row = within(article);
  expect(article.textContent).toMatch(title);
  if (direction) expect(row.getByText(direction)).toBeTruthy();
  if (outcome === 'live' && (fromMe || !missed)) expect(row.getByRole('timer')).toBeTruthy();
  else expect(row.getByText(clockTime(now - 1_000))).toBeTruthy();
});

test.each([
  ['en', 'Outgoing call · less than a minute'],
  ['fr', 'Appel sortant · moins d’une minute']
] as const)('renders short call durations using the %s catalogue', async (locale, title) => {
  await useLocaleStore(pinia).select(locale);
  render(DmCallEvent, {
    props: {
      projection: projection({ outcome: 'completed', durationMs: 59_000 }),
      fromMe: true,
      peerId: ada.id,
      peerName: ada.displayName,
      createdAt: now
    },
    global: { plugins: [pinia] }
  });
  expect(screen.getByRole('article').textContent).toContain(title);
});

test('an open DM anchors one call row through terminal and out-of-order events', async () => {
  const { socket } = await start({
    '/api/dm/ada/history?mode=latest&limit=50': {
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [
          {
            kind: 'dm',
            id: 'call-message',
            createdAt: now,
            content: { type: 'text', text: 'Call history' },
            cursor: 'call-cursor',
            readCursor: 'call-cursor',
            author: { userId: self.id },
            recipientId: ada.id,
            metadata: { kind: 'voice-call', call: projection() }
          }
        ],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    }
  });
  const lobby = useLobbyStore(pinia);
  const stopLobby = lobby.init(self.id);
  try {
    await lobby.openDm(ada.id);
    const send = (type: 'dm.message' | 'dm.message.edited', call: DirectMessageCall) =>
      socket.receive({
        type,
        payload: {
          message: {
            id: 'call-message',
            senderId: self.id,
            recipientId: ada.id,
            createdAt: now,
            editedAt: type === 'dm.message.edited' ? now + 220 : null,
            readAt: null,
            invite: null,
            body: 'Call history',
            call
          }
        }
      });
    render(
      defineComponent(() => {
        provideLobby(lobby);
        return () => h(DmView, { self });
      }),
      { global: { plugins: [pinia] } }
    );
    await flush();
    const row = screen.getByRole('article');
    const scroller = row.closest('.dm-conversation__scroll');
    expect(scroller).toBeTruthy();
    if (!scroller) return;
    scroller.scrollTop = 23;
    send('dm.message.edited', projection({ revision: 2, outcome: 'completed', durationMs: 59_000 }));
    send('dm.message', projection());
    await flush();
    await lobby.thread.resync(ada.id);
    expect(screen.getByRole('article')).toBe(row);
    expect(row.textContent).toContain('Исходящий звонок · меньше минуты');
    expect(row.textContent).not.toContain('(изменено)');
    await fireEvent.contextMenu(row);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(scroller.scrollTop).toBe(23);
  } finally {
    stopLobby();
  }
});

test('calling back joins the still-open call, then starts a new call after it closes', async () => {
  const waiting = snapshot({
    caller: ada,
    recipient: self,
    attemptInviterUserId: ada.id,
    revision: 2,
    phase: 'alone',
    attemptResult: 'no_answer',
    allowedActions: ['join']
  });
  const { socket, calls: http } = await start({
    '/api/call-rings': { body: bootstrap({ activeCalls: [waiting] }) },
    [`POST /api/call-rings/${firstId}/actions`]: { body: answer(waiting) },
    'POST /api/call-rings': { body: answer(snapshot({ id: secondId })) }
  });
  const view = render(DmCallEvent, {
    props: {
      projection: projection({ revision: 2, missedAt: now }),
      fromMe: false,
      peerId: ada.id,
      peerName: ada.displayName,
      createdAt: now
    },
    global: { plugins: [pinia] }
  });
  const callback = () => screen.getByRole('button', { name: 'Перезвонить' });
  await vi.advanceTimersByTimeAsync(1);
  await fireEvent.click(callback());
  await flush();
  expect(http.filter(({ method }) => method === 'POST')).toMatchObject([
    { url: `/api/call-rings/${firstId}/actions`, body: { action: 'join', expectedAttempt: 1 } }
  ]);
  expect(openCall).toHaveBeenCalledWith(ada.id);
  realtimeState(socket, { ...waiting, phase: 'closed', revision: 3, endedAt: Date.now(), allowedActions: [] });
  await view.rerender({ projection: projection({ outcome: 'no_answer', revision: 3 }) });
  await vi.advanceTimersByTimeAsync(1);
  await fireEvent.click(callback());
  await flush();
  expect(http.filter(({ method }) => method === 'POST').at(-1)).toMatchObject({
    url: '/api/call-rings',
    body: { peerUserId: ada.id }
  });
  expect(openCall).toHaveBeenLastCalledWith(ada.id);
});

test('only the visible DM acknowledges a watermark and both devices clear the missed badge', async () => {
  const watermark = { messageId: 'missed-row', missedAt: now };
  const unread = { peerUserId: ada.id, count: 2, watermark };
  let updated: CallMissedUpdated = { ...unread, revision: 3, serverNow: now };
  const { socket, calls: http } = await start({
    '/api/call-rings': { body: bootstrap({ missed: [unread] }) },
    'POST /api/call-rings/missed/ada/seen': () => {
      updated = { ...updated, count: 0, watermark: null, revision: updated.revision + 1 };
      socket.receive({ type: 'call.missed.updated', payload: updated });
      return { body: { ok: true, ...updated } };
    }
  });
  const mountSidebar = (device: Pinia) => {
    const lobby = useLobbyStore(device);
    lobby.friends = [{ user: ada, online: true, unreadCount: 0, lastMessage: null, friendsSince: null }];
    return render(
      defineComponent(() => {
        provideLobby(lobby);
        return () =>
          h(Sidebar, {
            user: self,
            friendMenu: null
          });
      }),
      { global: { plugins: [device] } }
    );
  };
  const other = createPinia();
  const otherCalls = useFriendCallStore(other);
  const stopOther = otherCalls.startSession(self.id, { prepareVoice, openCall });
  try {
    const first = mountSidebar(pinia);
    const second = mountSidebar(other);
    await flush();
    const badge = (view: typeof first) => {
      if (!(view.container instanceof HTMLElement)) throw new Error('Expected a sidebar container');
      return within(view.container).queryByRole('img', { name: '2 пропущенных звонка' });
    };
    expect(badge(first)?.textContent?.trim()).toBe('2');
    expect(badge(second)).toBeTruthy();
    expect(http.some(({ method }) => method === 'POST')).toBe(false);

    setActivePinia(pinia);
    const lobby = useLobbyStore(pinia);
    await lobby.openDm(ada.id);
    const detach = lobby.thread.attachReader(ada.id);
    try {
      await flush();
      expect(http.find(({ method }) => method === 'POST')?.body).toEqual({ watermark });
      expect(badge(first)).toBeNull();
      expect(badge(second)).toBeNull();

      const next = { messageId: 'new-miss', missedAt: now + 1 };
      const seenRequests = () => http.filter(({ url }) => url.endsWith('/missed/ada/seen'));
      updated = { ...updated, count: 1, watermark: next, revision: updated.revision + 1, serverNow: now + 1 };
      socket.receive({ type: 'call.missed.updated', payload: updated });
      await flush();
      expect(seenRequests()).toHaveLength(1);
      lobby.thread.replace({
        id: next.messageId,
        senderId: ada.id,
        recipientId: self.id,
        createdAt: now,
        body: '',
        editedAt: null,
        readAt: null,
        call: projection({ revision: 2, missedAt: next.missedAt })
      });
      await flush();
      expect(seenRequests().map(({ body }) => body)).toEqual([{ watermark }, { watermark: next }]);
      socket.receive({ type: 'call.missed.updated', payload: { ...unread, revision: 3, serverNow: now } });
      await flush();
      expect(calls.missedForPeer(ada.id)?.count).toBe(0);
      expect(otherCalls.missedForPeer(ada.id)?.count).toBe(0);
    } finally {
      detach();
    }
  } finally {
    stopOther();
    setActivePinia(pinia);
  }
});

test('the desktop call stage belongs to its own DM and the chat composer sends while it is open', async () => {
  const { calls: http } = await start({
    'POST /api/call-rings': { body: answer(snapshot()) },
    'POST /api/dm/ada': {
      body: {
        ok: true,
        message: {
          id: 'sent',
          senderId: self.id,
          recipientId: ada.id,
          body: 'hello during the call',
          createdAt: now,
          editedAt: null,
          readAt: null,
          invite: null
        }
      }
    }
  });
  const lobby = useLobbyStore(pinia);
  selectPeer(lobby, bob);
  mountDm(lobby);
  await calls.dial(ada.id);
  await nextTick();
  expect(screen.queryByRole('region', { name: 'Звонок: Ада' })).toBeNull();
  selectPeer(lobby);
  await nextTick();
  expect(stage()).toBeTruthy();
  expect(within(dm()).getByRole('button', { name: 'Вернуться в звонок' })).toBeTruthy();
  expect(within(dm()).getByRole('button', { name: 'Добавить вложение' })).toBeTruthy();
  expect(within(dm()).getByRole('button', { name: 'Добавить эмодзи' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Открыть личные сообщения' })).toBeNull();

  const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
  await user.click(composer());
  await user.keyboard('hello during the call{Enter}');
  await flush();
  expect(http.find(({ url, method }) => url === '/api/dm/ada' && method === 'POST')?.body).toMatchObject({
    text: 'hello during the call'
  });
  expect(stage()).toBeTruthy();
});

test('the desktop call remembers a resized height through screen share, expansion, and reopening', async () => {
  const call = snapshot({ phase: 'connected', attemptResult: 'accepted', firstConnectedAt: now });
  await start({ 'POST /api/call-rings': { body: answer(call) } });
  await calls.dial(ada.id);
  const lobby = useLobbyStore(pinia);
  selectPeer(lobby);
  const view = mountDm(lobby);
  await nextTick();

  const handle = splitter();
  const initial = Number.parseInt(handle.getAttribute('aria-valuetext') ?? '', 10);
  await fireEvent.keyDown(handle, { key: 'ArrowDown' });
  const resized = `${initial + 16} px`;
  expect(handle.getAttribute('aria-valuetext')).toBe(resized);
  const field = composer();

  const voice = useVoiceSessionStore(pinia);
  const screenUi = useScreenUiStore(pinia);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  voice.roomId = 'opaque-room';
  await nextTick();
  const screenVideo = stage().querySelector('video');
  expect(screenVideo).toBeTruthy();
  screenUi.stageVisible = true;
  await nextTick();
  expect(stage().querySelector('video')).toBe(screenVideo);
  expect(within(stage()).getByRole('button', { name: 'Закрыть просмотр экрана' })).toBeTruthy();
  expect(handle.getAttribute('aria-valuetext')).toBe(resized);
  screenUi.stageVisible = false;
  voice.roomId = null;
  await nextTick();

  await fireEvent.click(within(stage()).getByRole('button', { name: 'Развернуть' }));
  expect(within(dm()).queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('separator', { name: 'Высота звонка' })).toBeNull();
  await fireEvent.click(within(stage()).getByRole('button', { name: 'Свернуть' }));
  expect(composer()).toBe(field);
  expect(splitter().getAttribute('aria-valuetext')).toBe(resized);

  view.unmount();
  mountDm(lobby);
  await nextTick();
  expect(splitter().getAttribute('aria-valuetext')).toBe(resized);
});

test('a connected desktop call lets its dock hide, but not before media joins or while a device menu is open', async () => {
  const call = snapshot({
    phase: 'connected',
    attemptResult: 'accepted',
    firstConnectedAt: now,
    aloneDeadline: null,
    seats: [
      { userId: self.id, status: 'present', reconnectUntil: null },
      { userId: ada.id, status: 'present', reconnectUntil: null }
    ]
  });
  await start({ 'POST /api/call-rings': { body: answer(call) } });
  await calls.dial(ada.id);
  selectPeer(useLobbyStore(pinia));
  mountDm();
  await nextTick();
  const autohides = () => stage().classList.contains('friend-call--dock-autohide');
  expect(within(stage()).getByRole('button', { name: 'Завершить' })).toBeTruthy();
  expect(autohides()).toBe(false);

  useVoiceSessionStore(pinia).roomId = 'opaque-room';
  await nextTick();
  expect(within(stage()).getByRole('group', { name: 'Управление звонком' })).toBeTruthy();
  expect(autohides()).toBe(true);

  await fireEvent.click(within(stage()).getByRole('button', { name: 'Выбрать микрофон' }));
  expect(autohides()).toBe(false);
  await fireEvent.click(within(stage()).getByRole('button', { name: 'Выбрать микрофон' }));
  expect(autohides()).toBe(true);
});

test('an encrypted call shows its safety code behind a lock, replaces it silently, and says so when the key fails', async () => {
  const call = snapshot({
    phase: 'connected',
    attemptResult: 'accepted',
    firstConnectedAt: now,
    aloneDeadline: null,
    seats: [
      { userId: self.id, status: 'present', reconnectUntil: null },
      { userId: ada.id, status: 'present', reconnectUntil: null }
    ]
  });
  await start({ 'POST /api/call-rings': { body: answer(call) } });
  await calls.dial(ada.id);
  selectPeer(useLobbyStore(pinia));
  mountDm();
  useVoiceSessionStore(pinia).roomId = 'opaque-room';
  const lock = () => within(stage()).queryByRole('button', { name: 'Звонок защищён сквозным шифрованием' });
  try {
    // While the key is agreed with a peer who is here, the stage says so in place, with no lock yet.
    callRuntime.callE2ee = { phase: 'agreeing', code: null, failure: null };
    await nextTick();
    expect(within(stage()).getByText('Устанавливаем защищённое соединение…').getAttribute('role')).toBe('status');
    expect(lock()).toBeNull();

    callRuntime.callE2ee = { phase: 'secured', code: ['🦊', '🍉', '🚀', '🐢'], failure: null };
    await nextTick();
    const button = lock();
    if (!button) throw new Error('no lock');
    await fireEvent.click(button);
    const code = screen.getByRole('list', { name: 'Код проверки звонка' });
    expect(
      within(code)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['🦊лиса', '🍉арбуз', '🚀ракета', '🐢черепаха']);

    // A restart agrees a new key: the open code changes in place and nothing pops up about it.
    callRuntime.callE2ee = { phase: 'secured', code: ['🐶', '🐶', '⭐', '🎁'], failure: null };
    await nextTick();
    expect(within(screen.getByRole('list', { name: 'Код проверки звонка' })).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('list', { name: 'Код проверки звонка' }).textContent).toBe(
      '🐶собака🐶собака⭐звезда🎁подарок'
    );
    expect(useToastsStore(pinia).items).toEqual([]);

    callRuntime.callE2ee = { phase: 'failed', code: null, failure: 'timeout' };
    await nextTick();
    expect(lock()).toBeNull();
    expect(stage().textContent).toContain('Не удалось установить защищённое соединение');
    expect(stage().textContent).toContain('Без шифрования звонок не идёт. Завершите его и позвоните снова.');
  } finally {
    callRuntime.callE2ee = null;
  }
});

test('a portrait call shows the compact header, opens chat over the call, and restores the stage', async () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal('matchMedia', (query: string) => (query === PORTRAIT_PHONE_QUERY ? media : new EventTarget()));
  const call = snapshot({
    phase: 'alone',
    firstConnectedAt: now - 12_000,
    allowedActions: ['leave', 're-ring']
  });
  await start({ 'POST /api/call-rings': { body: answer(call) } });
  await calls.dial(ada.id);
  const lobby = useLobbyStore(pinia);
  selectPeer(lobby);
  mountDm(lobby);

  const reRing = within(stage()).getByRole('button', { name: 'Позвонить снова' });
  const countdown = within(stage()).getByText('Ада покидает звонок').closest('.friend-call__countdown');
  expect(countdown?.contains(reRing)).toBe(false);
  expect(reRing.classList.contains('ui-button--size-lg')).toBe(true);
  expect(within(stage()).getByRole('button', { name: 'Назад' }).classList.contains('ui-icon-button--size-44')).toBe(
    true
  );
  expect(screen.queryByRole('separator', { name: 'Высота звонка' })).toBeNull();
  expect(within(dm()).queryByRole('textbox')).toBeNull();

  await fireEvent.click(within(stage()).getByRole('button', { name: 'Открыть личные сообщения' }));
  expect(composer()).toBeTruthy();
  expect(within(dm()).queryByRole('region', { name: 'Звонок: Ада' })).toBeNull();
  await fireEvent.click(within(dm()).getByRole('button', { name: 'Назад' }));
  expect(stage()).toBeTruthy();
  expect(within(dm()).queryByRole('textbox')).toBeNull();

  media.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
  await nextTick();
  expect(composer()).toBeTruthy();
  expect(countdown?.contains(within(stage()).getByRole('button', { name: 'Позвонить снова' }))).toBe(true);
});
