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

const self = authUser({ id: 'me', login: 'me', displayName: 'Я' });
const ada = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

function message(id: string, senderId: string, body: string, extra: Partial<DirectMessage> = {}): DirectMessage {
  const recipientId = senderId === 'me' ? 'ada' : 'me';
  return { id, senderId, recipientId, body, createdAt: 1_000, editedAt: null, readAt: null, ...extra };
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
    const row = screen.getByText(text).closest<HTMLElement>('[data-message-id]')!;
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

  const incoming = screen.getByText('Планёрка').closest('article')!;
  expect(within(incoming).getByText('Приглашение в комнату')).toBeTruthy();
  expect(within(incoming).getByRole('button', { name: 'Войти' })).toBeTruthy();

  const sent = screen.getByText('Мой созвон').closest('article')!;
  expect(within(sent).getByText('Приглашение отправлено')).toBeTruthy();
  expect(within(sent).queryByRole('button')).toBeNull();
});

test('a thread stays behind the loading note until its emoji artwork has loaded', async () => {
  const incomplete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
  const lobby = renderDm();
  lobby.thread.loading = true;
  flushSync();
  expect(screen.getByRole('status').textContent).toBe('Загружаем переписку…');

  lobby.thread.messages = [message('m1', 'ada', 'привет 👍')];
  lobby.thread.loading = false;
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByRole('status').textContent).toBe('Загружаем переписку…');
  expect(document.querySelector('.lobby-dm-thread')?.classList.contains('is-settling')).toBe(true);

  incomplete.mockRestore();
  for (const image of document.querySelectorAll('.lobby-dm-thread img')) image.dispatchEvent(new Event('load'));
  await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(document.querySelector('.lobby-dm-thread')?.classList.contains('is-settling')).toBe(false);
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
