import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RoomChatPanel from '../../src/lib/features/room/components/RoomChatPanel.svelte';
import type { RoomMessage } from '@voice-room/shared/contracts/messages';
import { stubFetch, type Reply } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';

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

afterEach(cleanup);

function renderPanel(props: Record<string, unknown> = {}) {
  const base = {
    roomId: 'room',
    peerId: 'me',
    sessionToken: 'token',
    resolveDisplayName: () => 'Я',
    onToast: vi.fn(),
    ...props
  };
  const view = render(RoomChatPanel, { props: base });
  return { ...view, props: base };
}

const composer = () => screen.getByRole('textbox', { name: 'Написать в комнату…' });
const editor = () => screen.queryByRole('textbox', { name: 'Текст сообщения' });

test('ArrowUp in an empty composer edits the latest own message and saves it as the viewing peer', async () => {
  const edited = roomMessage('m2', 'me', 'исправлено', { editedAt: NOW + 1 });
  const { calls } = stubRoom({ 'PATCH /api/rooms/room/chat/m2': { body: { ok: true, message: edited } } });
  renderPanel();
  await screen.findByText('последнее моё');

  await userEvent.click(composer());
  await userEvent.keyboard('{ArrowUp}');
  expect(editor()?.textContent).toBe('последнее моё');

  await userEvent.clear(editor()!);
  await userEvent.type(editor()!, 'исправлено{Enter}');
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
  const row = screen.getByText(text).closest<HTMLElement>('[data-message-id]')!;
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

test('a sent message posts as the viewing peer and empties the composer; a failed one keeps the text', async () => {
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
  expect(await screen.findByText(/Сервер недоступен|Не удалось/)).toBeTruthy();
  expect(composer().textContent).toBe('привет всем');

  fail = false;
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText('привет всем', { selector: '.chat-msg-content *, .chat-msg-content' })).toBeTruthy();
  expect(composer().textContent).toBe('');
  const posts = calls.filter((call) => call.method === 'POST' && call.url === '/api/rooms/room/chat');
  expect(posts[1]?.body).toMatchObject({ name: 'Я', peerId: 'me', sessionToken: 'token', text: 'привет всем' });
  expect((posts[0]?.body as { idempotencyKey: string }).idempotencyKey).toBe(
    (posts[1]?.body as { idempotencyKey: string }).idempotencyKey
  );
});

test("a guest's unsent text survives a look at the participants tab", async () => {
  stubRoom();
  const { rerender, props } = renderPanel();
  await screen.findByText('от Ады');
  await userEvent.click(composer());
  await userEvent.keyboard('не отправлено');

  await rerender({ ...props, activeTab: 'participants' });
  expect(screen.queryByRole('textbox')).toBeNull();
  await rerender({ ...props, activeTab: 'chat' });
  expect(composer().textContent).toBe('не отправлено');
});
