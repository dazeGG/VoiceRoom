import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import DmView from '@/features/home/components/lobby/DmView.vue';
import { LOBBY_KEY } from '@/features/home/model/lobby-context';
import { useLobbyStore, type LobbyStore } from '@/features/home/model/lobby.store';
import { useToastsStore } from '@/features/home/model/toasts.store';
import type { DirectMessage } from '@/api/dm';
import { loadChatDraft } from '@/shared/chat/chat-drafts';
import { SendDirectMessageBody } from '@voice-room/shared/contracts/messages';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
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

test('only the author is offered edit and delete in the message menu', async () => {
  await renderDm(ada, [message('m1', 'ada', 'от Ады'), message('m2', 'me', 'от меня')]);

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

test("an open thread asks for each message's reactions once, however the answers come back", async () => {
  const lobby = useLobbyStore(pinia);
  await open(lobby, ada, [message('m1', 'me', 'раз'), message('m2', 'ada', 'два'), message('m3', 'me', 'три')]);
  const { calls } = stubFetch({
    '/api/reactions/dm/ada/m1': { body: { ok: true, summaries: [] } },
    '/api/reactions/dm/ada/m2': { body: { ok: true, summaries: [] } },
    '/api/reactions/dm/ada/m3': { status: 500, body: { ok: false, error: 'boom' } }
  });
  mount(lobby);
  await screen.findByText('три');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const asked = calls.filter((call) => call.url.startsWith('/api/reactions/')).map((call) => call.url);
  expect(asked.sort()).toEqual(['/api/reactions/dm/ada/m1', '/api/reactions/dm/ada/m2', '/api/reactions/dm/ada/m3']);
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
