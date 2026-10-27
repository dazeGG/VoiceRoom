import { cleanup, render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import RoomChatPanel from '@/features/room/components/RoomChatPanel.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { PostRoomMessageBody, type RoomMessage } from '@voice-room/shared/contracts/messages';
import { stubFetch, type Reply } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { defined, instanceOf, parse } from '../helpers/assert.ts';

const NOW = Date.now();

function roomMessage(id: string, peerId: string, text: string, extra: Partial<RoomMessage> = {}): RoomMessage {
  return {
    authorUserId: null,
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    createdAt: NOW,
    editedAt: null,
    id,
    name: peerId === 'me' ? 'Я' : 'Ада',
    peerId,
    roomId: 'room',
    text,
    attachments: [],
    ...extra
  };
}

const history = [
  roomMessage('m1', 'me', 'первое моё'),
  roomMessage('m2', 'me', 'последнее моё'),
  roomMessage('m3', 'ada', 'от Ады')
];

function stubRoom(extra: Record<string, Reply> = {}) {
  return stubFetch({
    'GET /api/rooms/room/chat': { body: { ok: true, roomId: 'room', messages: history } },
    'GET /api/rooms/room/pins': { body: { ok: true, pins: [], count: 0 } },
    'POST /api/rooms/room/read': { body: { ok: true } },
    ...extra
  });
}

beforeEach(() => {
  installFakeWebSocket();
  localStorage.clear();
});

// The session is set before the panel mounts: it decides which history the panel reads.
function renderPanel(props: Record<string, unknown> = {}, options: { signedIn?: boolean } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  if (options.signedIn) useSessionStore(pinia).user = authUser();
  const base = {
    roomId: 'room',
    peerId: 'me',
    sessionToken: 'token',
    resolveDisplayName: () => 'Я',
    onToast: vi.fn(),
    ...props
  };
  const view = render(RoomChatPanel, { props: base, global: { plugins: [pinia] } });
  return { ...view, props: base };
}

const composer = () => screen.getByRole('textbox', { name: 'Написать в комнату…' });
const editor = () => screen.queryByRole('textbox', { name: 'Текст сообщения' });
const MESSAGE_TEXT = '.room-chat-group__content *, .room-chat-group__content';

test('ArrowUp in an empty composer edits the latest own message and saves it as the viewing peer', async () => {
  const edited = roomMessage('m2', 'me', 'исправлено', { editedAt: NOW + 1 });
  const { calls } = stubRoom({ 'PATCH /api/rooms/room/chat/m2': { body: { ok: true, message: edited } } });
  renderPanel();
  await screen.findByText('последнее моё');

  await userEvent.click(composer());
  await userEvent.keyboard('{ArrowUp}');
  expect(editor()?.textContent).toBe('последнее моё');

  await userEvent.clear(defined(editor(), 'editor'));
  await userEvent.type(defined(editor(), 'editor'), 'исправлено{Enter}');
  expect(await screen.findByText('исправлено')).toBeTruthy();
  expect(editor()).toBeNull();
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
    peerId: 'me',
    sessionToken: 'token',
    text: 'исправлено'
  });
});

test('a refused edit keeps the editor open and says why', async () => {
  stubRoom({ 'PATCH /api/rooms/room/chat/m2': { status: 403, body: { ok: false, error: 'Нельзя' } } });
  renderPanel();
  await screen.findByText('последнее моё');
  await userEvent.click(composer());
  await userEvent.keyboard('{ArrowUp}{End} ещё{Enter}');
  expect(await screen.findByText(/Нельзя|Не удалось/)).toBeTruthy();
  expect(editor()).toBeTruthy();
});

async function menuLabels(text: string): Promise<string[]> {
  const row = instanceOf(screen.getByText(text).closest('[data-message-id]'), HTMLElement, 'message row');
  await userEvent.pointer({ keys: '[MouseRight]', target: row });
  const menu = await screen.findByRole('menu');
  const labels = within(menu)
    .queryAllByRole('menuitem')
    .map((item) => item.textContent?.trim() ?? '');
  await userEvent.keyboard('{Escape}');
  return labels;
}

test('only the author may edit; the owner of the room may also delete', async () => {
  stubRoom();
  renderPanel();
  await screen.findByText('от Ады');
  const theirs = await menuLabels('от Ады');
  expect(theirs.some((label) => label.includes('Изменить'))).toBe(false);
  expect(theirs.some((label) => label.includes('Удалить'))).toBe(false);
  const mine = await menuLabels('последнее моё');
  expect(mine.some((label) => label.includes('Изменить'))).toBe(true);
  expect(mine.some((label) => label.includes('Удалить'))).toBe(true);
  cleanup();

  renderPanel({ canModerate: true });
  await screen.findByText('от Ады');
  const moderated = await menuLabels('от Ады');
  expect(moderated.some((label) => label.includes('Изменить'))).toBe(false);
  expect(moderated.some((label) => label.includes('Удалить'))).toBe(true);
});

test('a failed message stays in the chat with its error and goes out again, as the same message, on retry', async () => {
  const sent = roomMessage('m4', 'me', 'привет всем');
  let fail = true;
  const { calls } = stubRoom({
    'POST /api/rooms/room/chat': () =>
      fail ? { status: 500, body: { ok: false, error: 'Сервер недоступен' } } : { body: { ok: true, message: sent } }
  });
  renderPanel();
  await screen.findByText('от Ады');

  await userEvent.click(composer());
  await userEvent.keyboard('привет всем{Enter}');
  expect(composer().textContent).toBe('');
  const failed = await screen.findByRole('alert');
  expect(failed.textContent).toMatch(/Не отправлено/);
  expect(screen.getByText('привет всем', { selector: '.outgoing-messages__text' })).toBeTruthy();

  fail = false;
  await userEvent.click(within(failed).getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('привет всем', { selector: MESSAGE_TEXT })).toBeTruthy();
  await vi.waitFor(() => expect(document.querySelector('.outgoing-messages__item')).toBeNull());
  const posts = calls.filter((call) => call.method === 'POST' && call.url === '/api/rooms/room/chat');
  expect(posts[1]?.body).toMatchObject({ name: 'Я', peerId: 'me', sessionToken: 'token', text: 'привет всем' });
  expect(parse(PostRoomMessageBody, posts[0]?.body).idempotencyKey).toBe(
    parse(PostRoomMessageBody, posts[1]?.body).idempotencyKey
  );
});

test('a failed message can be dropped from the chat', async () => {
  stubRoom({ 'POST /api/rooms/room/chat': { status: 500, body: { ok: false, error: 'Сервер недоступен' } } });
  renderPanel();
  await screen.findByText('от Ады');
  await userEvent.click(composer());
  await userEvent.keyboard('не нужно{Enter}');
  await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Удалить' }));
  expect(screen.queryByText('не нужно')).toBeNull();
});

test("a guest's unsent text survives a look at the participants tab", async () => {
  stubRoom();
  const view = renderPanel();
  const { props } = view;
  await screen.findByText('от Ады');
  await userEvent.click(composer());
  await userEvent.keyboard('не отправлено');

  await view.rerender({ ...props, activeTab: 'participants' });
  expect(screen.queryByRole('textbox')).toBeNull();
  await view.rerender({ ...props, activeTab: 'chat' });
  expect(composer().textContent).toBe('не отправлено');
});

test('messages sent while one is on its way show dimmed and go out in order; a failed one does not hold up the rest', async () => {
  let fail = false;
  const { calls } = stubRoom({
    'POST /api/rooms/room/chat': (init) => {
      if (fail) return { status: 500, body: { ok: false, error: 'Сервер недоступен' } };
      const posted: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      const text = defined(parse(PostRoomMessageBody, posted).text, 'posted text');
      return { body: { ok: true, message: roomMessage(`sent-${text}`, 'me', text) } };
    }
  });
  // Each post waits until the test lets it answer.
  const answer = globalThis.fetch.bind(globalThis);
  const waiting: Array<() => void> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === 'POST' && url === '/api/rooms/room/chat') {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    return answer(input, init);
  });
  const releaseNext = async () => {
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    defined(waiting.shift(), 'a waiting post')();
  };
  renderPanel();
  await screen.findByText('от Ады');

  await userEvent.click(composer());
  await userEvent.keyboard('первое{Enter}');
  expect(composer().textContent).toBe('');
  await userEvent.keyboard('второе{Enter}');
  expect(composer().textContent).toBe('');
  expect([...document.querySelectorAll('.outgoing-messages__text')].map((element) => element.textContent)).toEqual([
    'первое',
    'второе'
  ]);
  expect(screen.getAllByText('Отправляется…')).toHaveLength(2);
  await releaseNext();
  await releaseNext();
  expect(await screen.findByText('второе', { selector: MESSAGE_TEXT })).toBeTruthy();
  await vi.waitFor(() => expect(document.querySelector('.outgoing-messages__item')).toBeNull());
  const texts = () =>
    calls
      .filter((call) => call.method === 'POST' && call.url === '/api/rooms/room/chat')
      .map((call) => parse(PostRoomMessageBody, call.body).text);
  expect(texts()).toEqual(['первое', 'второе']);

  fail = true;
  await userEvent.keyboard('третье{Enter}');
  await userEvent.keyboard('четвёртое{Enter}');
  await releaseNext();
  expect(await screen.findByRole('alert')).toBeTruthy();
  fail = false;
  await releaseNext();
  expect(await screen.findByText('четвёртое', { selector: MESSAGE_TEXT })).toBeTruthy();
  expect(texts()).toEqual(['первое', 'второе', 'третье', 'четвёртое']);
  expect(screen.getByText('третье', { selector: '.outgoing-messages__text' })).toBeTruthy();
  expect(composer().textContent).toBe('');
});

test('an account refused paged history reads the recent window, like a guest, instead of an error', async () => {
  // A room just entered is not kept yet (a temporary one never is), and paged
  // history is for rooms the account keeps.
  const { calls } = stubRoom({
    'GET /api/rooms/room/chat/history?mode=latest&limit=50': {
      status: 403,
      body: { ok: false, error: 'Room is not available', code: 'room_forbidden' }
    }
  });
  renderPanel({}, { signedIn: true });

  expect(await screen.findByText('от Ады')).toBeTruthy();
  expect(screen.queryByText('Комната недоступна')).toBeNull();
  expect(calls.some((call) => call.url === '/api/rooms/room/chat')).toBe(true);
  // Pins are for rooms the account keeps too: no point asking here.
  expect(calls.filter((call) => call.url.endsWith('/pins'))).toEqual([]);
});

test('pins are asked for in a room the account keeps, and never by a guest', async () => {
  const guest = stubRoom();
  renderPanel();
  await screen.findByText('от Ады');
  expect(guest.calls.filter((call) => call.url.endsWith('/pins'))).toEqual([]);
  cleanup();

  const keeper = stubRoom({
    'GET /api/rooms/room/chat/history?mode=latest&limit=50': {
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    }
  });
  renderPanel({}, { signedIn: true });
  await vi.waitFor(() => expect(keeper.calls.some((call) => call.url.endsWith('/pins'))).toBe(true));
});

test('a reader at the newest message stays on it when loading artwork grows the chat', async () => {
  const observed: Element[] = [];
  const callbacks = new Map<Element, () => void>();
  const onResize = () => callbacks.get(body)?.();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(readonly callback: () => void) {}
      observe(element: Element) {
        observed.push(element);
        callbacks.set(element, this.callback);
      }
      unobserve() {}
      disconnect() {}
    }
  );
  stubRoom();
  renderPanel();
  await screen.findByText('от Ады');
  const body = instanceOf(document.querySelector('.room-chat-panel__body'), HTMLElement, 'chat body');
  await vi.waitFor(() => expect(observed).toContain(body));
  expect(observed.some((element) => element.classList.contains('room-chat-panel__day'))).toBe(true);

  let height = 1000;
  Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 400 });
  body.scrollTop = 600;
  body.dispatchEvent(new Event('scroll'));
  height = 1300;
  onResize();
  expect(body.scrollTop).toBe(1300);

  body.scrollTop = 100;
  body.dispatchEvent(new Event('scroll'));
  height = 1600;
  onResize();
  expect(body.scrollTop).toBe(100);
});

test('a panel open at mount parks on the newest message once the history is in', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });
  try {
    stubRoom();
    renderPanel();
    await screen.findByText('от Ады');
    const body = instanceOf(document.querySelector('.room-chat-panel__body'), HTMLElement, 'chat body');
    await vi.waitFor(() => expect(body.scrollTop).toBe(1000));
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  }
});

test('a right-click on a picture offers to copy and save it; on the text it does not', async () => {
  const picture = {
    id: 'att-1',
    context: 'room',
    order: 0,
    mimeType: 'image/webp',
    bytes: 1000,
    width: 40,
    height: 30,
    state: 'ready',
    url: null
  } as const;
  const withPicture = roomMessage('m4', 'ada', 'смотри', { attachments: [picture] });
  const { fetchMock } = stubFetch({
    'GET /api/rooms/room/chat': { body: { ok: true, roomId: 'room', messages: [...history, withPicture] } },
    'GET /api/rooms/room/pins': { body: { ok: true, pins: [], count: 0 } },
    'POST /api/rooms/room/read': { body: { ok: true } }
  });
  // The picture itself comes as a PNG, which goes to the clipboard as it is.
  const answerJson = fetchMock.getMockImplementation();
  if (!answerJson) throw new Error('the fetch stub has no implementation');
  fetchMock.mockImplementation(async (input, init) =>
    input === '/api/media/attachments/att-1/processed'
      ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
      : answerJson(input, init)
  );
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  const copied: Blob[] = [];
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    for (const item of items) copied.push(...(await Promise.all(Object.values(item.items))));
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  const clicked: HTMLAnchorElement[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
  renderPanel();
  await screen.findByText('смотри');

  const onText = await menuLabels('смотри');
  expect(onText).not.toContain('Скопировать изображение');
  expect(onText).not.toContain('Скачать изображение');

  const image = document.querySelector('[data-attachment-id="att-1"] img');
  if (!image) throw new Error('the picture is not in the chat');
  await userEvent.pointer({ keys: '[MouseRight]', target: image });
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Скачать изображение/ }));
  expect(clicked.at(-1)?.getAttribute('href')).toBe('/api/media/attachments/att-1/processed?download=1');
  expect(clicked.at(-1)?.hasAttribute('download')).toBe(true);

  await userEvent.pointer({ keys: '[MouseRight]', target: image });
  await userEvent.click(
    within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Скопировать изображение/ })
  );
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(copied.map((blob) => blob.type)).toEqual(['image/png']));

  click.mockRestore();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});
