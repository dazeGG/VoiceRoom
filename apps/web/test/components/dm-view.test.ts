import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import DmView from '@/features/home/components/lobby/DmView.vue';
import ChatContextMenu from '@/features/home/components/lobby/ChatContextMenu.vue';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { LOBBY_KEY } from '@/features/home/model/lobby-context';
import { useLobbyStore, type LobbyStore } from '@/features/home/model/lobby.store';
import { useToastsStore } from '@/features/home/model/toasts.store';
import type { DirectMessage } from '@/api/dm';
import { loadChatDraft } from '@/shared/chat/chat-drafts';
import {
  SendDirectMessageBody,
  type ConversationSummary,
  type DirectContact
} from '@voiceroom/shared/contracts/messages';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { instanceOf, parse, defined } from '../helpers/assert.ts';

const self = authUser({ id: 'me', login: 'me', displayName: 'Я' });
const ada = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

let pinia: Pinia;

function message(id: string, senderId: string, body: string, extra: Partial<DirectMessage> = {}): DirectMessage {
  const recipientId = senderId === 'me' ? 'ada' : 'me';
  return { id, senderId, recipientId, body, createdAt: 1_000, editedAt: null, readAt: null, invite: null, ...extra };
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  stubFetch({});
  // The lobby opens its realtime socket; a real one would reach whatever listens on localhost.
  installFakeWebSocket();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function open(lobby: LobbyStore, peer: typeof ada, messages: DirectMessage[] = []): Promise<void> {
  lobby.view = 'dm';
  lobby.selectedFriendId = peer.id;
  lobby.thread.peer = peer;
  lobby.thread.messages = messages;
  await nextTick();
}

function mount(lobby: LobbyStore) {
  return render(DmView, { props: { self }, global: { plugins: [pinia], provide: { [LOBBY_KEY]: lobby } } });
}

async function renderDm(peer = ada, messages: DirectMessage[] = []): Promise<LobbyStore> {
  const lobby = useLobbyStore(pinia);
  await open(lobby, peer, messages);
  mount(lobby);
  return lobby;
}

const composer = () => screen.getByRole('textbox', { name: /Написать сообщение|^$/ });

const allowedContact: DirectContact = {
  peer: ada,
  isFriend: false,
  canMessage: true,
  messageReason: 'allowed',
  canCall: false
};

function emptyHistory(contact: DirectContact) {
  return {
    contractVersion: 1,
    mode: 'latest',
    messages: [],
    pageInfo: { hasMoreBefore: false, hasMoreAfter: false },
    contact
  };
}

function conversation(isFriend: boolean): ConversationSummary {
  return {
    peer: { ...ada, badge: null },
    lastMessage: { preview: 'Old message', kind: 'text', at: 1000, fromMe: false },
    unreadCount: 2,
    isFriend,
    muted: false
  };
}

test('the DM header offers a delete confirmation and closes the deleted conversation', async () => {
  const { calls } = stubFetch({ 'DELETE /api/dm/ada': { status: 204 } });
  const lobby = await renderDm(ada, [message('old-message', ada.id, 'Old message')]);
  lobby.conversations = [conversation(true)];
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Ещё' }));
  await user.click(screen.getByRole('menuitem', { name: 'Удалить переписку' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Удалить переписку?' });
  expect(dialog.textContent).toContain('Все сообщения и файлы исчезнут у вас и у @ada. Отменить это нельзя.');
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Ещё' }));
  await user.click(screen.getByRole('menuitem', { name: 'Удалить переписку' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }));
  expect(calls).toContainEqual({ method: 'DELETE', url: '/api/dm/ada', body: undefined });
  expect(lobby.selectedFriendId).toBeNull();
  expect(lobby.conversations).toEqual([]);
});

test.each([true, false])('chat row menu offers deletion and block confirmation (friend: %s)', async (isFriend) => {
  const { calls } = stubFetch({ 'PUT /api/blocks/ada': { body: { ok: true, status: 'blocked' } } });
  const lobby = useLobbyStore(pinia);
  const anchor = document.createElement('button');
  render(ChatContextMenu, {
    props: { modelValue: { anchor, x: 0, y: 0, isFriend, friend: { user: ada, online: false } } },
    global: { plugins: [pinia], provide: { [LOBBY_KEY]: lobby } }
  });
  expect(await screen.findByRole('menuitem', { name: 'Удалить переписку' })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Заблокировать пользователя?' });
  expect(within(dialog).getByText('@ada')).toBeTruthy();
  const checkbox = within(dialog).getByRole('checkbox', { name: 'Удалить переписку' });
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  expect(within(dialog).getByRole('button', { name: /^Заблокировать$/ })).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: 'Заблокировать и удалить' })).toBeNull();
  await user.click(checkbox);
  await user.click(within(dialog).getByRole('button', { name: 'Заблокировать и удалить' }));
  expect(calls).toContainEqual({ method: 'PUT', url: '/api/blocks/ada', body: { deleteConversation: true } });
});

test('the deletion event closes the peer thread and clears its unread and missed-call badges', async () => {
  let deleted = false;
  stubFetch({
    '/api/dm/conversations': { body: { ok: true, conversations: [] } },
    'GET /api/dm/ada/history?mode=latest&limit=50': () => ({
      body: { ...emptyHistory(allowedContact), messages: deleted ? [] : [historyMessage('old-message', 'c1')] }
    }),
    '/api/call-rings': { body: { ok: true, enabled: true, activeCalls: [], incoming: [], missed: [], serverNow: 0 } }
  });
  const lobby = useLobbyStore(pinia);
  const calls = useFriendCallStore(pinia);
  const stop = lobby.init(self.id);
  const stopCalls = calls.startSession(self.id, { prepareVoice: async () => {}, openCall: () => {} });
  try {
    const socket = FakeWebSocket.latest();
    socket.open();
    socket.receive({ type: 'ready', payload: { userId: self.id } });
    await lobby.openDm(ada.id);
    expect(lobby.thread.messages.map(({ id }) => id)).toEqual(['old-message']);
    lobby.conversations = [conversation(true)];
    lobby.friends = [{ user: ada, unreadCount: 2, online: false, friendsSince: null, lastMessage: null }];
    socket.receive({
      type: 'call.missed.updated',
      payload: {
        peerUserId: ada.id,
        count: 1,
        revision: 4,
        serverNow: 1000,
        watermark: { missedAt: 1000, messageId: 'e023cd93-1b2e-4ec3-9144-a60844c862c1' }
      }
    });
    expect(calls.missedForPeer(ada.id)?.count).toBe(1);

    deleted = true;
    socket.receive({ type: 'dm.conversation.deleted', payload: { peerId: ada.id } });

    expect(lobby.view).toBe('home');
    expect(lobby.selectedFriendId).toBeNull();
    expect(lobby.thread.messages).toEqual([]);
    expect(lobby.conversations).toEqual([]);
    expect(lobby.friends[0]?.unreadCount).toBe(0);
    expect(calls.missedForPeer(ada.id)?.count).toBe(0);
    const reopening = lobby.openDm(ada.id);
    expect(lobby.thread.messages).toEqual([]);
    await reopening;
  } finally {
    stopCalls();
    stop();
  }
});

test('a send refusal closes the composer when the empty thread can no longer be read', async () => {
  let closed = false;
  stubFetch({
    'GET /api/dm/ada/history?mode=latest&limit=50': () =>
      closed
        ? {
            status: 403,
            body: {
              ok: false,
              code: 'thread_forbidden',
              error: 'Thread is not available',
              messageReason: 'not_selected'
            }
          }
        : { body: emptyHistory(allowedContact) },
    'POST /api/dm/ada': { status: 403, body: { ok: false, code: 'messages_closed', error: 'Messages closed' } }
  });
  const lobby = useLobbyStore(pinia);
  await lobby.openDm(ada.id);
  mount(lobby);
  expect(composer()).toBeTruthy();

  closed = true;
  await userEvent.type(composer(), 'первое сообщение{Enter}');
  expect(await screen.findByText('@ada принимает сообщения только от выбранных пользователей')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: /Написать сообщение|^$/ })).toBeNull();
});

test('a live call card edit refreshes the open composer after a peer re-ring', async () => {
  let contact: DirectContact = { ...allowedContact, canMessage: false, messageReason: 'unanswered_cap' };
  stubFetch({ 'GET /api/dm/ada/history?mode=latest&limit=50': () => ({ body: emptyHistory(contact) }) });
  const lobby = useLobbyStore(pinia);
  const stop = lobby.init(self.id);
  try {
    const socket = FakeWebSocket.latest();
    socket.open();
    socket.receive({ type: 'ready', payload: { userId: self.id } });
    await lobby.openDm(ada.id);
    mount(lobby);
    expect(await screen.findByText('Дождитесь ответа, чтобы отправить ещё одно сообщение')).toBeTruthy();

    contact = allowedContact;
    socket.receive({
      type: 'dm.message.edited',
      payload: {
        message: message('call', self.id, '', {
          call: {
            callId: '52bc51a6-b4f9-4149-bc0b-c3aced36e223',
            revision: 4,
            outcome: 'live',
            startedAt: 1_000,
            firstConnectedAt: 2_000,
            endedAt: null,
            durationMs: 0,
            endReason: null,
            endedByUserId: null,
            missedAt: null,
            missedRevision: null,
            missedSeenRevision: null
          }
        })
      }
    });
    expect(await screen.findByRole('textbox', { name: /Написать сообщение|^$/ })).toBeTruthy();
  } finally {
    stop();
  }
});

test('a stranger sees the contact actions and a refusal replaces the composer without hiding history', async () => {
  const lobby = await renderDm(ada, [message('m1', 'ada', 'предыдущее сообщение')]);
  lobby.thread.contact = { peer: ada, isFriend: false, canMessage: true, messageReason: 'allowed', canCall: false };
  expect(await screen.findByText('Ада не в ваших друзьях')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Добавить в друзья' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeTruthy();
  expect(composer()).toBeTruthy();
  lobby.thread.contact = {
    peer: ada,
    isFriend: false,
    canMessage: false,
    messageReason: 'friends_only',
    canCall: false
  };
  expect(await screen.findByText('@ada принимает сообщения только от друзей')).toBeTruthy();
  expect(screen.getByText('Ада не в ваших друзьях')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Добавить в друзья' })).toHaveLength(2);
  expect(screen.queryByRole('textbox', { name: /Написать сообщение|^$/ })).toBeNull();
  expect(screen.getByText('предыдущее сообщение')).toBeTruthy();
});

test('ArrowUp in an empty composer edits the latest own message, and Escape leaves it as it was', async () => {
  await renderDm(ada, [
    message('m1', 'me', 'первое моё'),
    message('m2', 'me', 'последнее моё'),
    message('m3', 'ada', 'ответ Ады')
  ]);

  await userEvent.click(composer());
  await userEvent.keyboard('{ArrowUp}');
  const editor = screen.getByRole('textbox', { name: 'Текст сообщения' });
  expect(editor.textContent).toBe('последнее моё');

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('textbox', { name: 'Текст сообщения' })).toBeNull();
  expect(screen.getByText('последнее моё')).toBeTruthy();
});

test('ArrowUp with text in the composer moves the caret instead of editing', async () => {
  await renderDm(ada, [message('m1', 'me', 'моё')]);
  await userEvent.click(composer());
  await userEvent.keyboard('черновик{ArrowUp}');
  expect(screen.queryByRole('textbox', { name: 'Текст сообщения' })).toBeNull();
});

test('each thread keeps its own unsent text', async () => {
  const lobby = await renderDm(ada);
  await userEvent.click(composer());
  await userEvent.keyboard('для Ады');

  await open(lobby, bob);
  expect(composer().textContent).toBe('');
  await userEvent.click(composer());
  await userEvent.keyboard('для Боба');

  await open(lobby, ada);
  expect(composer().textContent).toBe('для Ады');
  await open(lobby, bob);
  expect(composer().textContent).toBe('для Боба');
});

test('switching threads closes an open editor', async () => {
  const lobby = await renderDm(ada, [message('m1', 'me', 'моё')]);
  await userEvent.click(composer());
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('textbox', { name: 'Текст сообщения' })).toBeTruthy();

  await open(lobby, bob, [message('b1', 'me', 'Бобу')]);
  expect(screen.queryByRole('textbox', { name: 'Текст сообщения' })).toBeNull();
});

test('the author is offered delete, with edit available only when messaging is allowed', async () => {
  const lobby = await renderDm(ada, [message('m1', 'ada', 'от Ады'), message('m2', 'me', 'от меня')]);

  const menuItems = async (text: string): Promise<string[]> => {
    const row = instanceOf(screen.getByText(text).closest('[data-message-id]'), HTMLElement, 'message row');
    await userEvent.pointer({ keys: '[MouseRight]', target: row });
    const menu = await screen.findByRole('menu');
    const labels = within(menu)
      .queryAllByRole('menuitem')
      .map((item) => item.textContent?.trim() ?? '');
    await userEvent.keyboard('{Escape}');
    return labels;
  };

  const theirs = await menuItems('от Ады');
  expect(theirs.some((label) => label.includes('Изменить'))).toBe(false);
  expect(theirs.some((label) => label.includes('Удалить'))).toBe(false);

  const mine = await menuItems('от меня');
  expect(mine.some((label) => label.includes('Изменить'))).toBe(true);
  expect(mine.some((label) => label.includes('Удалить'))).toBe(true);

  lobby.thread.contact = { peer: ada, isFriend: false, canCall: false, canMessage: false, messageReason: 'blocked' };
  await nextTick();
  const readOnly = await menuItems('от меня');
  expect(readOnly.some((label) => label.includes('Изменить'))).toBe(false);
  expect(readOnly.some((label) => label.includes('Удалить'))).toBe(true);
});

test('an invitation is answered from the card by the invited side only', async () => {
  const invite = { roomId: 'r1', roomName: 'Планёрка', status: 'pending' as const, expiresAt: null };
  await renderDm(ada, [
    message('i1', 'ada', '', { invite }),
    message('i2', 'me', '', { invite: { ...invite, roomName: 'Мой созвон' } })
  ]);

  const incoming = instanceOf(screen.getByText('Планёрка').closest('article'), HTMLElement, 'incoming invite');
  expect(within(incoming).getByText('Приглашение в комнату')).toBeTruthy();
  expect(within(incoming).getByRole('button', { name: 'Войти' })).toBeTruthy();

  const sent = instanceOf(screen.getByText('Мой созвон').closest('article'), HTMLElement, 'sent invite');
  expect(within(sent).getByText('Приглашение отправлено')).toBeTruthy();
  expect(within(sent).queryByRole('button')).toBeNull();
});

test('a thread shows its messages as soon as they arrive, while its artwork is still loading', async () => {
  const incomplete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
  const lobby = await renderDm();
  lobby.thread.loading = true;
  await nextTick();
  expect(screen.getByRole('status').textContent).toBe('Загружаем переписку…');

  lobby.thread.messages = [message('m1', 'ada', 'привет 👍')];
  lobby.thread.loading = false;
  await nextTick();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText(/привет/)).toBeTruthy();
  incomplete.mockRestore();
});

test('a reader at the newest message stays on it when loading artwork grows the thread', async () => {
  // Reka's floating panels (the composer's popovers) keep their own observers; only the one on the scroll counts.
  const observers: Array<{ callback: () => void; watched: Set<Element> }> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly watched = new Set<Element>();
      constructor(readonly callback: () => void) {
        observers.push(this);
      }
      observe(element: Element) {
        this.watched.add(element);
      }
      unobserve(element: Element) {
        this.watched.delete(element);
      }
      disconnect() {
        this.watched.clear();
      }
    }
  );
  await renderDm(ada, [message('m1', 'ada', 'картинка'), message('m2', 'me', 'ответ')]);
  const scroll = instanceOf(document.querySelector('.dm-conversation__scroll'), HTMLElement, 'conversation scroll');
  let height = 1000;
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 400 });
  const watching = observers.filter((observer) => observer.watched.has(scroll));
  expect(watching).toHaveLength(1);
  const grow = defined(watching[0], 'scroll observer').callback;

  scroll.scrollTop = 600;
  scroll.dispatchEvent(new Event('scroll'));
  height = 1300;
  grow();
  expect(scroll.scrollTop).toBe(1300);

  scroll.scrollTop = 100;
  scroll.dispatchEvent(new Event('scroll'));
  height = 1600;
  grow();
  expect(scroll.scrollTop).toBe(100);
});

test("an open thread asks for its messages' reactions once, in one request", async () => {
  const lobby = useLobbyStore(pinia);
  await open(lobby, ada, [message('m1', 'me', 'раз'), message('m2', 'ada', 'два'), message('m3', 'me', 'три')]);
  const { calls } = stubFetch({
    '/api/reactions/dm/ada?ids=m1,m2,m3': { body: { ok: true, messages: {} } }
  });
  mount(lobby);
  await screen.findByText('три');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const asked = calls.filter((call) => call.url.startsWith('/api/reactions/')).map((call) => call.url);
  expect(asked).toEqual(['/api/reactions/dm/ada?ids=m1,m2,m3']);
});

test('a sent message empties the field at once, shows dimmed, and a failed one waits in its thread to be retried', async () => {
  let fail = true;
  const { calls } = stubFetch({
    'POST /api/dm/ada': () =>
      fail
        ? { status: 500, body: { ok: false, error: 'Сервер недоступен' } }
        : { body: { ok: true, message: message('sent-1', 'me', 'привет') } },
    'POST /api/dm/ada/read': { body: { ok: true } }
  });
  const lobby = await renderDm(ada);
  await userEvent.click(composer());
  await userEvent.keyboard('привет{Enter}');
  expect(composer().textContent).toBe('');
  expect(screen.getByText('привет', { selector: '.outgoing-messages__text' })).toBeTruthy();
  const failed = await screen.findByRole('alert');
  expect(failed.textContent).toMatch(/Не отправлено/);
  for (const action of ['Повторить', 'Удалить']) {
    expect(within(failed).getByRole('button', { name: action }).getAttribute('type')).toBe('button');
  }

  await open(lobby, bob);
  expect(document.querySelector('.outgoing-messages__item')).toBeNull();
  await open(lobby, ada);
  fail = false;
  await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('привет', { selector: '.dm-group__content *, .dm-group__content' })).toBeTruthy();
  await vi.waitFor(() => expect(document.querySelector('.outgoing-messages__item')).toBeNull());
  const keys = calls
    .filter((call) => call.method === 'POST' && call.url === '/api/dm/ada')
    .map((call) => parse(SendDirectMessageBody, call.body).idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test('a new message settles the thread at the newest message while its height keeps growing', async () => {
  const lobby = await renderDm(ada, [message('m1', 'ada', 'раньше')]);
  const scroll = instanceOf(document.querySelector('.dm-conversation__scroll'), HTMLElement, 'conversation scroll');
  let height = 1000;
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 400 });

  // Artwork and emoji fonts resize the rows on a later frame, after the first scroll.
  requestAnimationFrame(() => {
    height = 1300;
  });
  lobby.thread.messages = [...lobby.thread.messages, message('m2', 'ada', 'новое')];
  await nextTick();

  await vi.waitFor(() => expect(scroll.scrollTop).toBe(1300));
});

test('a message that cannot be copied says so as an error, like the room chat does', async () => {
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, { clipboard: { value: { writeText: () => Promise.reject(new Error('denied')) } } })
  );
  const toasts = useToastsStore(pinia);
  await renderDm(ada, [message('m1', 'ada', 'скопируй')]);

  await userEvent.click(screen.getByRole('button', { name: 'Копировать текст' }));

  await vi.waitFor(() => expect(toasts.items.at(-1)?.message).toBe('Не удалось скопировать'));
  expect(toasts.items.at(-1)?.variant).toBe('error');
});

test('an unsent text is stored after a pause in typing, not at every key, and at once when the page hides', async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
  await renderDm(ada);
  const saved = () => loadChatDraft('me', { type: 'dm', id: 'ada' })?.text;
  await user.click(composer());
  await user.keyboard('чер');
  expect(saved()).toBeUndefined();

  await vi.advanceTimersByTimeAsync(399);
  await user.keyboard('нов');
  await vi.advanceTimersByTimeAsync(399);
  expect(saved()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(saved()).toBe('чернов');

  await user.keyboard('ик');
  window.dispatchEvent(new Event('pagehide'));
  expect(saved()).toBe('черновик');
});

function historyMessage(id: string, readCursor: string) {
  return {
    kind: 'dm' as const,
    id,
    createdAt: 1_000,
    content: { type: 'text' as const, text: id },
    cursor: readCursor,
    readCursor,
    author: { userId: 'ada' },
    recipientId: 'me'
  };
}

test('a burst of live messages asks once for the newest cursor, not for a page of history each', async () => {
  let newest = historyMessage('m1', 'c1');
  const page = () => ({
    body: {
      ok: true,
      contractVersion: 1,
      mode: 'latest',
      messages: [newest],
      pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
    }
  });
  const { calls } = stubFetch({
    'GET /api/dm/ada/history?mode=latest&limit=50': page,
    'GET /api/dm/ada/history?mode=latest&limit=1': page,
    'POST /api/dm/ada/read': { body: { ok: true } }
  });
  const asked = (limit: number) =>
    calls.filter((call) => call.url === `/api/dm/ada/history?mode=latest&limit=${limit}`).length;
  const lobby = useLobbyStore(pinia);
  const stop = lobby.init('me');
  const socket = FakeWebSocket.latest();
  socket.open();
  mount(lobby);
  await lobby.openDm('ada');
  await vi.waitFor(() => expect(asked(50)).toBe(1));

  newest = historyMessage('m4', 'c4');
  for (const id of ['m2', 'm3', 'm4']) {
    socket.receive({ type: 'dm.message', payload: { message: message(id, 'ada', id) } });
  }

  await vi.waitFor(() => expect(asked(1)).toBe(1), { timeout: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(asked(1)).toBe(1);
  expect(asked(50)).toBe(1);
  await vi.waitFor(() =>
    expect(calls.filter((call) => call.method === 'POST').at(-1)?.body).toMatchObject({ cursor: 'c4' })
  );
  stop();
});

test('a hidden conversation reports nothing as read, and a shown one does again', async () => {
  let newest = historyMessage('m1', 'c1');
  const { calls } = stubFetch({
    'GET /api/dm/ada/history?mode=latest&limit=50': () => ({
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [newest],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    }),
    'GET /api/dm/ada/history?mode=latest&limit=1': () => ({
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [newest],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    }),
    'POST /api/dm/ada/read': { body: { ok: true } }
  });
  const reads = () => calls.filter((call) => call.method === 'POST' && call.url === '/api/dm/ada/read').length;
  const lobby = useLobbyStore(pinia);
  const stop = lobby.init('me');
  const socket = FakeWebSocket.latest();
  socket.open();
  const arrive = (id: string): void =>
    socket.receive({ type: 'dm.message', payload: { message: message(id, 'ada', id) } });

  const shown = mount(lobby);
  await lobby.openDm('ada');
  await vi.waitFor(() => expect(reads()).toBe(1));

  // The rooms side is showing: the DM view is not mounted, though the thread stays selected.
  shown.unmount();
  newest = historyMessage('m2', 'c2');
  arrive('m2');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reads()).toBe(1);

  mount(lobby);
  newest = historyMessage('m3', 'c3');
  arrive('m3');
  await vi.waitFor(() => expect(reads()).toBeGreaterThan(1));
  stop();
});

const voiceroom = authUser({ id: OFFICIAL_ACCOUNT_ID, login: 'voiceroom', displayName: 'VoiceRoom' });

test('the official VoiceRoom chat opens without call, profile, friendship or block actions', async () => {
  const lobby = await renderDm(voiceroom, [
    message('m1', OFFICIAL_ACCOUNT_ID, 'Спасибо, чиним', { recipientId: 'me' }),
    message('m2', 'me', 'Жду', { recipientId: OFFICIAL_ACCOUNT_ID })
  ]);
  lobby.thread.contact = {
    peer: voiceroom,
    isFriend: false,
    canMessage: true,
    messageReason: 'allowed',
    canCall: false
  };
  expect(await screen.findByText('Спасибо, чиним')).toBeTruthy();
  expect(screen.getByText('@voiceroom')).toBeTruthy();
  expect(screen.queryByText('VoiceRoom не в ваших друзьях')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Профиль' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Добавить в друзья' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Заблокировать' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Позвонить/ })).toBeNull();
  expect(composer()).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Ещё' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Удалить переписку' })).toBeTruthy();
  for (const name of ['Профиль', 'Добавить в друзья', 'Заблокировать', 'Позвонить'])
    expect(within(menu).queryByRole('menuitem', { name })).toBeNull();
});
