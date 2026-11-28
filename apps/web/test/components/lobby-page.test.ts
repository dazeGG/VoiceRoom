// The lobby signs out when the server ends this device's session: quietly when
// this device asked for it, with a message when it happened elsewhere. A
// ?dm= link lands on that conversation. An administrator gets the panel in
// the header, at its own address, and a new report as a notice that stays.

import { fireEvent, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import LobbyPage from '@/features/home/LobbyPage.vue';
import type { ToastOptions } from '@/features/home/model/toasts.store';
import type { ConversationSummary } from '@voiceroom/shared/contracts/messages';
import { useSessionStore } from '@/features/auth/session.store';
import { state as roomClientState } from '@voiceroom/call/engine/core/room-runtime.store';
import { useVoiceSessionStore } from '@voiceroom/call/engine/core/voice-session.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { directMessage, publicUser } from '../fixtures/answers.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { defined } from '../helpers/assert.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { stubSplitterLayout } from '../helpers/splitter-layout';
import { renderWithApp } from '../helpers/render.ts';

stubOverlayDom();

const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });
const clea = publicUser({ id: 'clea', login: 'clea', displayName: 'Клеа' });

function chat(
  peer: Pick<ConversationSummary['peer'], 'id' | 'login' | 'displayName'>,
  at: number,
  unreadCount = 0
): ConversationSummary {
  return {
    peer: { ...publicUser({ ...peer, presenceStatus: 'online' }), badge: null },
    lastMessage: { at, kind: 'text', preview: 'Hello', fromMe: false },
    unreadCount,
    isFriend: true,
    muted: false
  };
}

beforeEach(() => {
  installFakeWebSocket();
  stubMatchMedia();
});
afterEach(() => {
  window.history.replaceState(null, '', '/app');
  localStorage.removeItem('voice-room:lobby-sidebar-width');
  localStorage.removeItem('voice-room:lobby-sidebar-collapsed');
  roomClientState.roomId = '';
  roomClientState.roomName = '';
});

function stubLobby(extra: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    'GET /api/dm/conversations': { body: { ok: true, conversations: [chat(bob, 1, 2)] } },
    ...extra,
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': {
      body: {
        ok: true,
        incomingRequestCount: 0,
        friends: [{ user: bob, online: true, friendsSince: 1, lastMessage: null, unreadCount: 2 }]
      }
    },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } },
    'GET /api/dm/bob/history?mode=latest&limit=50': {
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    }
  });
}

async function renderLobby() {
  const onToast = vi.fn<(message: string, options?: ToastOptions) => void>();
  const view = await renderWithApp(LobbyPage, { props: { user, loggingOut: false, onLogout: vi.fn(), onToast } });
  const session = useSessionStore(view.pinia);
  session.setUser(user);
  return { ...view, onToast, session };
}

async function socket(): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const current = FakeWebSocket.latest();
  current.open();
  return current;
}

test('the sidebar clamps drag widths, cancels interrupted drags and restores its saved width after collapse', async () => {
  stubLobby();
  stubSplitterLayout();
  const user = userEvent.setup();
  const view = await renderLobby();
  const separator = screen.getByRole('separator', { name: 'Ширина боковой панели' });
  const width = () => Number.parseInt(separator.getAttribute('aria-valuetext') ?? '', 10);
  expect(width()).toBe(280);

  await fireEvent.touchStart(separator, { touches: [{ clientX: 280, clientY: 10 }] });
  await fireEvent.touchMove(separator, { touches: [{ clientX: 600, clientY: 10 }] });
  expect(width()).toBe(420);
  await fireEvent.touchCancel(separator, { touches: [] });
  expect(width()).toBe(280);

  const startDrag = (x: number) => user.pointer({ keys: '[MouseLeft>]', target: separator, coords: { x, y: 10 } });
  const moveDrag = (x: number) => user.pointer({ target: separator, coords: { x, y: 10 } });
  const endDrag = (x: number) => user.pointer({ keys: '[/MouseLeft]', target: separator, coords: { x, y: 10 } });

  await startDrag(280);
  await moveDrag(320);
  await endDrag(320);
  expect(width()).toBe(320);

  await startDrag(320);
  await moveDrag(200);
  expect(width()).toBe(240);
  await moveDrag(100);
  expect(width()).toBe(48);
  expect(screen.queryByRole('complementary')).toBeNull();
  await moveDrag(220);
  expect(width()).toBe(240);
  await moveDrag(100);
  await endDrag(100);
  expect(screen.queryByRole('separator')).toBeNull();
  expect(screen.queryByRole('complementary')).toBeNull();

  view.unmount();
  const reopened = await renderLobby();
  const rail = defined(reopened.container.querySelector('.lobby-shell__sidebar'), 'sidebar rail');
  expect(rail.querySelector('.sidebar-rail .sidebar__brand-mark')).toBeTruthy();
  expect(rail.querySelector('.sidebar-rail__account .ui-avatar')).toBeTruthy();
  await vi.waitFor(() => expect(rail.querySelector('.sidebar-rail__chats .ui-avatar__dot--online')).toBeTruthy());
  expect(rail.querySelector('.sidebar-rail__badge')?.textContent).toBe('2');
  expect(screen.queryByRole('separator')).toBeNull();
  await fireEvent.pointerOver(screen.getByRole('button', { name: 'Как вам VoiceRoom?' }), { pointerType: 'mouse' });
  expect(screen.queryByRole('complementary')).toBeNull();
  await fireEvent.pointerOver(rail, { pointerType: 'mouse' });
  expect(screen.getByRole('complementary')).toBeTruthy();
  expect(screen.queryByRole('separator')).toBeNull();
  expect(rail.closest('.lobby-shell')?.classList.contains('lobby-shell--sidebar-collapsed')).toBe(true);
  await fireEvent.pointerLeave(rail, { pointerType: 'mouse' });
  expect(screen.queryByRole('complementary')).toBeNull();
  await fireEvent.pointerOver(rail, { pointerType: 'mouse' });
  await fireEvent.keyDown(screen.getByRole('button', { name: 'Развернуть боковую панель' }), { key: 'Escape' });
  expect(screen.queryByRole('complementary')).toBeNull();
  await fireEvent.pointerOver(rail, { pointerType: 'mouse' });
  await userEvent.click(screen.getByRole('button', { name: 'Развернуть боковую панель' }));
  await fireEvent.pointerLeave(rail, { pointerType: 'mouse' });
  expect(screen.getByRole('complementary')).toBeTruthy();
  const restored = screen.getByRole('separator', { name: 'Ширина боковой панели' });
  expect(restored.getAttribute('aria-valuetext')).toBe('320 px');
  restored.focus();
  await user.keyboard('{ArrowRight}');
  expect(restored.getAttribute('aria-valuetext')).toBe('336 px');
  await userEvent.click(screen.getByRole('button', { name: 'Свернуть боковую панель' }));
  expect(screen.queryByRole('separator')).toBeNull();
});

test('the sidebar lists conversations in activity order and updates for incoming messages and unfriending', async () => {
  let conversations = [chat(clea, 2), chat(bob, 1, 2)];
  stubLobby({ 'GET /api/dm/conversations': () => ({ body: { ok: true, conversations } }) });
  await renderLobby();
  const sidebar = screen.getByRole('complementary');
  const friends = within(sidebar).getByRole('button', { name: /^Друзья/ });
  const chats = within(sidebar).getByRole('region', { name: 'Чаты' });
  expect(friends.compareDocumentPosition(chats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const ordered = () =>
    within(chats)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
  await within(chats).findByRole('button', { name: 'Клеа' });
  expect(ordered()).toEqual(['Новый чат', 'Клеа', 'Боб']);

  const realtime = await socket();
  conversations = [chat(bob, 3, 3), chat(clea, 2)];
  realtime.receive({
    type: 'dm.message',
    payload: { message: directMessage({ senderId: bob.id, recipientId: user.id, createdAt: 3 }) }
  });
  await vi.waitFor(() => expect(ordered()).toEqual(['Новый чат', 'Боб', 'Клеа']));
  expect(within(chats).getByRole('img', { name: '3 непрочитанных' })).toBeTruthy();

  conversations = [{ ...chat(bob, 3, 3), isFriend: false }, chat(clea, 2)];
  realtime.receive({ type: 'friend.removed', payload: { userId: bob.id } });
  const stranger = within(chats).getByRole('button', { name: 'Боб' });
  await vi.waitFor(() => expect(stranger.querySelector('.ui-avatar__dot--online')).toBeNull());
  expect(ordered()).toEqual(['Новый чат', 'Боб', 'Клеа']);
});

test('an empty chat list opens the new chat dialog', async () => {
  stubLobby({ 'GET /api/dm/conversations': { body: { ok: true, conversations: [] } } });
  await renderLobby();
  expect(await screen.findByText('Пока нет чатов')).toBeTruthy();
  await userEvent.click(defined(screen.getAllByRole('button', { name: 'Новый чат' })[1], 'empty state action'));
  expect(screen.getByRole('dialog', { name: 'Новый чат' })).toBeTruthy();
});

test('the chat context menu marks the conversation read and updates the unread badge', async () => {
  let unreadCount = 2;
  const { calls } = stubLobby({
    'GET /api/dm/conversations': () => ({ body: { ok: true, conversations: [chat(bob, 1, unreadCount)] } }),
    'POST /api/dm/bob/read': () => {
      unreadCount = 0;
      return { body: { ok: true, count: 2 } };
    }
  });
  await renderLobby();
  const row = await screen.findByRole('button', { name: 'Боб' });
  expect(within(row).getByRole('img', { name: '2 непрочитанных' })).toBeTruthy();
  expect(row.querySelector('.ui-avatar__dot--online')).toBeTruthy();
  row.focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  const menu = await screen.findByRole('menu', { name: 'Действия для Боб' });
  for (const name of [
    'Профиль',
    'Отметить прочитанным',
    'Выключить уведомления',
    'Удалить из друзей',
    'Заблокировать'
  ]) {
    expect(within(menu).getByRole('menuitem', { name })).toBeTruthy();
  }
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Отметить прочитанным' }));
  await vi.waitFor(() => expect(within(row).queryByRole('img', { name: '2 непрочитанных' })).toBeNull());
  expect(calls.some(({ method, url }) => method === 'POST' && url === '/api/dm/bob/read')).toBe(true);
});

test('a non-friend conversation offers adding instead of removal and hides a closed call action', async () => {
  stubLobby({
    'GET /api/dm/conversations': {
      body: { ok: true, conversations: [{ ...chat(bob, 1), isFriend: false, canCall: false }] }
    }
  });
  await renderLobby();
  const row = await screen.findByRole('button', { name: 'Боб' });
  row.focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  const menu = within(await screen.findByRole('menu', { name: 'Действия для Боб' }));
  expect(menu.getByText('Не друг')).toBeTruthy();
  for (const name of [
    'Профиль',
    'Добавить в друзья',
    'Отметить прочитанным',
    'Выключить уведомления',
    'Заблокировать'
  ]) {
    expect(menu.getByRole('menuitem', { name })).toBeTruthy();
  }
  expect(menu.queryByRole('menuitem', { name: 'Удалить из друзей' })).toBeNull();
  expect(menu.queryByRole('menuitem', { name: 'Позвонить' })).toBeNull();
});

test('a session ended on another device signs out with a message', async () => {
  stubLobby();
  const { onToast, session } = await renderLobby();
  (await socket()).serverClose(4401);

  await vi.waitFor(() => expect(session.user).toBeNull());
  expect(onToast).toHaveBeenCalledWith('Сеанс на этом устройстве завершён. Войдите снова');
});

test("this device's own sign-out ends the session without a second message", async () => {
  stubLobby();
  const { onToast, session } = await renderLobby();
  const current = await socket();
  session.expectSessionEnd();
  current.serverClose(4401);

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(onToast).not.toHaveBeenCalledWith('Сеанс на этом устройстве завершён. Войдите снова');
  expect(session.user).not.toBeNull();
});

test('a ?dm= link opens that conversation', async () => {
  window.history.replaceState(null, '', '/app?dm=bob');
  const { calls } = stubLobby();
  await renderLobby();

  expect(await screen.findByRole('region', { name: 'Личные сообщения' })).toBeTruthy();
  await vi.waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/dm/bob/history?'))).toBe(true));
});

test('the call card names a room the list does not have, such as a temporary one', async () => {
  stubLobby();
  roomClientState.roomId = 'tmp123';
  roomClientState.roomName = 'Созвон';
  const { pinia } = await renderLobby();
  useVoiceSessionStore(pinia).roomId = 'tmp123';

  expect(await screen.findByRole('button', { name: 'Открыть комнату Созвон' })).toBeTruthy();
});

const asStaff = (openReports = 0) => ({
  'GET /api/staff/access': { body: { ok: true, staff: true, adminUrl: 'https://admin.example.test/', openReports } }
});

test('staff get an entry to the admin app beside the logo, with the open reports on it', async () => {
  stubLobby(asStaff(2));
  await renderLobby();
  const entry = await screen.findByRole('button', { name: 'Открыть админку' });
  expect(within(entry).getByLabelText('открытых жалоб: 2')).toBeTruthy();
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  await userEvent.click(entry);
  expect(opened).toHaveBeenCalledWith('https://admin.example.test/', '_blank', 'noopener');
  opened.mockRestore();
});

test('an account that is not staff gets no link', async () => {
  stubLobby({
    'GET /api/staff/access': { body: { ok: true, staff: false, adminUrl: null, openReports: 0 } }
  });
  await renderLobby();
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Открыть настройки' })).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('button', { name: 'Открыть админку' })).toBeNull();
});

test('a new report reaches staff as a notice that stays until closed and opens the reports in the admin app', async () => {
  stubLobby(asStaff(0));
  const { onToast } = await renderLobby();
  const current = await socket();
  await screen.findByRole('button', { name: 'Открыть админку' });
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);

  current.receive({
    type: 'admin.reports',
    payload: { openReports: 1, filed: { reason: 'spam', targetKind: 'room_message', roomName: 'Кухня' } }
  });
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Новая жалоба', expect.anything()));
  const options = defined(
    defined(
      onToast.mock.calls.find(([message]) => message === 'Новая жалоба'),
      'report notice'
    )[1],
    'notice options'
  );
  expect(options).toMatchObject({ duration: 0, description: 'Спам или реклама · комната «Кухня»' });
  expect(
    within(await screen.findByRole('button', { name: 'Открыть админку' })).getByLabelText('открытых жалоб: 1')
  ).toBeTruthy();

  defined(defined(options.actions, 'notice actions')[0], 'the notice action').onClick('toast-1');
  expect(opened).toHaveBeenCalledWith('https://admin.example.test/reports', '_blank', 'noopener');
  opened.mockRestore();

  // A resolved report only moves the count.
  onToast.mockClear();
  current.receive({ type: 'admin.reports', payload: { openReports: 0, filed: null } });
  await vi.waitFor(() => expect(screen.queryByLabelText('открытых жалоб: 1')).toBeNull());
  expect(onToast).not.toHaveBeenCalled();
});
