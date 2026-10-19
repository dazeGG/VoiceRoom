import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import DmView from '../../src/lib/features/home/components/lobby/DmView.svelte';
import { lobbyContext } from '../../src/lib/features/home/model/lobby-context.ts';
import { LobbyStore } from '../../src/lib/features/home/model/lobby.svelte.ts';
import type { DirectMessage } from '../../src/lib/api/dm.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { instanceOf, parse } from '../helpers/assert.ts';
import { SendDirectMessageBody } from '@voice-room/shared/contracts/messages';

const self = authUser({ id: 'me', login: 'me', displayName: 'Я' });
const ada = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

function message(id: string, senderId: string, body: string, extra: Partial<DirectMessage> = {}): DirectMessage {
  const recipientId = senderId === 'me' ? 'ada' : 'me';
  return { id, senderId, recipientId, body, createdAt: 1_000, editedAt: null, readAt: null, invite: null, ...extra };
}

beforeEach(() => {
  stubFetch({});
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function open(lobby: LobbyStore, peer: typeof ada, messages: DirectMessage[] = []): void {
  lobby.view = 'dm';
  lobby.selectedFriendId = peer.id;
  lobby.thread.peer = peer;
  lobby.thread.messages = messages;
  flushSync();
}

function renderDm(peer = ada, messages: DirectMessage[] = []) {
  const lobby = new LobbyStore();
  open(lobby, peer, messages);
  render(DmView, { props: { self }, context: lobbyContext(lobby) });
  return lobby;
}

const composer = () => screen.getByRole('textbox', { name: /Написать сообщение|^$/ });

test('ArrowUp in an empty composer edits the latest own message, and Escape leaves it as it was', async () => {
  renderDm(ada, [
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
  renderDm(ada, [message('m1', 'me', 'моё')]);
  await userEvent.click(composer());
  await userEvent.keyboard('черновик{ArrowUp}');
  expect(screen.queryByRole('textbox', { name: 'Текст сообщения' })).toBeNull();
});

test('each thread keeps its own unsent text', async () => {
  const lobby = renderDm(ada);
  await userEvent.click(composer());
  await userEvent.keyboard('для Ады');

  open(lobby, bob);
  expect(composer().textContent).toBe('');
  await userEvent.click(composer());
  await userEvent.keyboard('для Боба');

  open(lobby, ada);
  expect(composer().textContent).toBe('для Ады');
  open(lobby, bob);
  expect(composer().textContent).toBe('для Боба');
});

test('switching threads closes an open editor', async () => {
  const lobby = renderDm(ada, [message('m1', 'me', 'моё')]);
  await userEvent.click(composer());
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('textbox', { name: 'Текст сообщения' })).toBeTruthy();

  open(lobby, bob, [message('b1', 'me', 'Бобу')]);
  expect(screen.queryByRole('textbox', { name: 'Текст сообщения' })).toBeNull();
});

test('only the author is offered edit and delete in the message menu', async () => {
  renderDm(ada, [message('m1', 'ada', 'от Ады'), message('m2', 'me', 'от меня')]);

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

test('an invitation is answered from the card by the invited side only', () => {
  const invite = { roomId: 'r1', roomName: 'Планёрка', status: 'pending' as const, expiresAt: null };
  renderDm(ada, [
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

test('a thread shows its messages as soon as they arrive, while its artwork is still loading', () => {
  const incomplete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
  const lobby = renderDm();
  lobby.thread.loading = true;
  flushSync();
  expect(screen.getByRole('status').textContent).toBe('Загружаем переписку…');

  lobby.thread.messages = [message('m1', 'ada', 'привет 👍')];
  lobby.thread.loading = false;
  flushSync();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText(/привет/)).toBeTruthy();
  incomplete.mockRestore();
});

test('a reader at the newest message stays on it when loading artwork grows the thread', () => {
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  renderDm(ada, [message('m1', 'ada', 'картинка'), message('m2', 'me', 'ответ')]);
  const scroll = instanceOf(document.querySelector('.lobby-dm-scroll'), HTMLElement, 'conversation scroll');
  let height = 1000;
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 400 });
  expect(observers).toHaveLength(1);

  scroll.scrollTop = 600;
  scroll.dispatchEvent(new Event('scroll'));
  height = 1300;
  observers[0]();
  expect(scroll.scrollTop).toBe(1300);

  scroll.scrollTop = 100;
  scroll.dispatchEvent(new Event('scroll'));
  height = 1600;
  observers[0]();
  expect(scroll.scrollTop).toBe(100);
});

test("an open thread asks for each message's reactions once, however the answers come back", async () => {
  const lobby = new LobbyStore();
  open(lobby, ada, [message('m1', 'me', 'раз'), message('m2', 'ada', 'два'), message('m3', 'me', 'три')]);
  const { calls } = stubFetch({
    '/api/reactions/dm/ada/m1': { body: { ok: true, summaries: [] } },
    '/api/reactions/dm/ada/m2': { body: { ok: true, summaries: [] } },
    '/api/reactions/dm/ada/m3': { status: 500, body: { ok: false, error: 'boom' } }
  });
  render(DmView, { props: { self }, context: lobbyContext(lobby) });
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
  const lobby = renderDm(ada);
  await userEvent.click(composer());
  await userEvent.keyboard('привет{Enter}');
  expect(composer().textContent).toBe('');
  expect(screen.getByText('привет', { selector: '.outgoing-message__text' })).toBeTruthy();
  const failed = await screen.findByRole('alert');
  expect(failed.textContent).toMatch(/Не отправлено/);

  open(lobby, bob);
  expect(document.querySelector('.outgoing-message')).toBeNull();
  open(lobby, ada);
  fail = false;
  await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('привет', { selector: '.dm-msg-content *, .dm-msg-content' })).toBeTruthy();
  await vi.waitFor(() => expect(document.querySelector('.outgoing-message')).toBeNull());
  const keys = calls
    .filter((call) => call.method === 'POST' && call.url === '/api/dm/ada')
    .map((call) => parse(SendDirectMessageBody, call.body).idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
