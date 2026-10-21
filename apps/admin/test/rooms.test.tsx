// The rooms section: who is in which room's voice now (an account by its name
// and login, a guest by the name it gave), refreshed every few seconds; an
// account opens its card; the history of finished stays loads a page at a
// time and narrows to one room; each seat says what its role may know of where
// it came from.

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { LiveRoom, LiveRooms, RoomHistory, RoomStay } from '@voice-room/shared/contracts/admin';
import { RoomsPage } from '../src/pages/RoomsPage.tsx';
import { stubApi, renderAs, type Call, type Reply } from './helpers/harness.tsx';

const MINUTE = 60_000;
const NEXT_PAGE = '1760000000000_6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const alice = {
  id: 'u-alice',
  login: 'alice',
  displayName: 'Алиса',
  avatarUrl: null,
  avatarColorKey: 'blurple',
  avatarAccent: null
};

function kitchen(): LiveRoom {
  return {
    roomId: 'kitchen',
    name: 'Кухня',
    isStatic: true,
    avatarUrl: null,
    owner: alice,
    since: Date.now() - 30 * MINUTE,
    peers: [
      {
        peerId: 'p-alice',
        name: 'Алиса',
        account: alice,
        avatarColorKey: 'blurple',
        joinedAt: Date.now() - 30 * MINUTE,
        muted: true,
        deafened: false,
        screen: false,
        client: 'desktop_app',
        os: 'Windows',
        browser: 'VoiceRoom Desktop',
        guestId: null,
        ipKey: '0123456789abcdef',
        location: 'Москва, Россия'
      },
      {
        peerId: 'p-guest',
        name: 'Петя',
        account: null,
        avatarColorKey: 'green',
        joinedAt: Date.now() - 5 * MINUTE,
        muted: false,
        deafened: false,
        screen: true,
        client: 'mobile',
        os: 'iOS',
        browser: 'Safari',
        guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        ipKey: 'fedcba9876543210',
        location: null
      }
    ]
  };
}

function stay(id: string, overrides: Partial<RoomStay> = {}): RoomStay {
  return {
    id,
    roomId: 'kitchen',
    roomName: 'Кухня',
    isStatic: true,
    account: null,
    guestName: null,
    guestId: null,
    client: null,
    os: null,
    browser: null,
    ipKey: null,
    location: null,
    joinedAt: Date.now() - 2 * 60 * MINUTE,
    leftAt: Date.now() - 60 * MINUTE,
    ...overrides
  };
}

const live = (rooms: LiveRoom[]): Reply => ({ body: { ok: true, rooms } satisfies LiveRooms });
const history = (stays: RoomStay[], next: string | null = null): Reply => ({
  body: { ok: true, stays, next, keepDays: 90 } satisfies RoomHistory
});

const historyCalls = (calls: Call[]) => calls.filter((call) => call.url.pathname === '/api/admin/rooms/history');

function rowsOf(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole('row');
}

function listItemOf(element: HTMLElement): HTMLElement {
  const item = element.closest('li');
  if (!item) throw new Error('not inside a list item');
  return item;
}

test('the section shows who is in voice now, accounts by login and guests by name, and an account opens its card', async () => {
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/history': history([])
  });
  const onOpenAccount = vi.fn();
  renderAs(<RoomsPage onOpenAccount={onOpenAccount} />);

  const card = listItemOf(await screen.findByRole('button', { name: 'Кухня' }));
  const [alicePeer, guestPeer, ...rest] = within(card).getAllByRole('listitem');
  if (!alicePeer || !guestPeer || rest.length > 0) throw new Error('two people expected');
  expect(within(alicePeer).getByText('@alice')).toBeTruthy();
  expect(within(alicePeer).getByLabelText('Микрофон выключен')).toBeTruthy();
  expect(within(guestPeer).getByText('Петя')).toBeTruthy();
  expect(within(guestPeer).getByText('гость')).toBeTruthy();
  expect(within(guestPeer).getByLabelText('Показывает экран')).toBeTruthy();
  // Where each one sits: the desktop app, a phone or a browser.
  expect(within(alicePeer).getByText('приложение')).toBeTruthy();
  expect(within(guestPeer).getByText('телефон')).toBeTruthy();
  expect(within(card).getByText('постоянная')).toBeTruthy();
  expect(screen.getByText(/комнат: 1, людей: 2/)).toBeTruthy();
  expect(await screen.findByText('Завершённых звонков пока нет.')).toBeTruthy();

  await userEvent.click(within(alicePeer).getByRole('button', { name: /Алиса/ }));
  expect(onOpenAccount).toHaveBeenCalledWith('u-alice');
});

test('the list of who is in voice refreshes every few seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let rooms: LiveRoom[] = [kitchen()];
  stubApi({
    'GET /api/admin/rooms': () => live(rooms),
    'GET /api/admin/rooms/history': history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  expect(await screen.findByText('Петя')).toBeTruthy();

  rooms = [];
  await vi.advanceTimersByTimeAsync(5000);
  expect(await screen.findByText('Сейчас никто не в звонке.')).toBeTruthy();
});

test('a failed refresh keeps the rooms already shown and says why', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let failing = false;
  stubApi({
    'GET /api/admin/rooms': () =>
      failing ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : live([kitchen()]),
    'GET /api/admin/rooms/history': history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  expect(await screen.findByText('Петя')).toBeTruthy();

  failing = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Петя')).toBeTruthy();
});

test('an unnamed temporary room that is still there goes by its code and is not marked deleted', async () => {
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/history': history([stay('s-tmp', { roomId: '8vjx8udrdu', roomName: '', isStatic: false })])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  const table = await screen.findByRole('table');
  expect(within(table).getByRole('button', { name: '8vjx8udrdu' })).toBeTruthy();
  expect(within(table).queryByText('удалена')).toBeNull();
});

test('the history loads a page at a time and narrows to one room', async () => {
  const pageOne = Array.from({ length: 3 }, (_, index) => stay(`s-${index}`));
  const calls = stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/history': (url) => {
      if (url.searchParams.get('after') === NEXT_PAGE) return history([stay('s-old', { account: alice })]);
      if (url.searchParams.get('roomId') === 'gone')
        return history([stay('s-gone', { roomId: 'gone', roomName: null })]);
      if (url.searchParams.get('roomId') === 'kitchen') return history([stay('s-kitchen')]);
      return history([...pageOne, stay('s-gone', { roomId: 'gone', roomName: null })], NEXT_PAGE);
    }
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  const table = await screen.findByRole('table');
  expect(rowsOf(table)).toHaveLength(1 + 4);
  // A temporary room is gone once empty: its row shows the code it was called by.
  expect(within(table).getByRole('button', { name: 'gone' })).toBeTruthy();
  expect(within(table).getByText('удалена')).toBeTruthy();

  // The next page replaces this one; going back asks for the first page again.
  expect(screen.getByRole('button', { name: 'Назад' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }));
  await waitFor(() => expect(rowsOf(screen.getByRole('table'))).toHaveLength(1 + 1));
  expect(within(screen.getByRole('table')).getByText('@alice')).toBeTruthy();
  expect(screen.getByText('Страница 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Дальше' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Назад' }));
  await waitFor(() => expect(rowsOf(screen.getByRole('table'))).toHaveLength(1 + 4));
  expect(historyCalls(calls).at(-1)?.url.searchParams.has('after')).toBe(false);
  expect(screen.getByText('Страница 1')).toBeTruthy();

  // A live room's name narrows the list; the chip takes it back to every room.
  await userEvent.click(
    within(screen.getByRole('list', { name: 'Сейчас в звонках' })).getByRole('button', { name: 'Кухня' })
  );
  await waitFor(() => expect(rowsOf(screen.getByRole('table'))).toHaveLength(2));
  expect(historyCalls(calls).at(-1)?.url.searchParams.get('roomId')).toBe('kitchen');
  await userEvent.click(screen.getByRole('button', { name: /Показать все комнаты/ }));
  await waitFor(() => expect(rowsOf(screen.getByRole('table'))).toHaveLength(1 + 4));
  expect(historyCalls(calls).at(-1)?.url.searchParams.has('roomId')).toBe(false);

  // So does a room in the history, a gone one too.
  await userEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'gone' }));
  await waitFor(() => expect(historyCalls(calls).at(-1)?.url.searchParams.get('roomId')).toBe('gone'));
});

test('a stay shows when it ended next to when it began, and its length in hours and minutes', async () => {
  const joinedAt = new Date(2026, 9, 15, 14, 30).getTime();
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/history': history([
      stay('s-long', { joinedAt, leftAt: joinedAt + 85 * MINUTE }),
      stay('s-night', { joinedAt: joinedAt + 9 * 60 * MINUTE, leftAt: joinedAt + 10 * 60 * MINUTE })
    ])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  const [, long, night] = rowsOf(await screen.findByRole('table'));
  if (!long || !night) throw new Error('two stays expected');
  expect(within(long).getByText('15 окт., 14:30 – 15:55')).toBeTruthy();
  expect(within(long).getByText('1 ч 25 мин')).toBeTruthy();
  // Past midnight the end carries its own date.
  expect(within(night).getByText('15 окт., 23:30 – 16 окт., 00:30')).toBeTruthy();
  expect(within(night).getByText('1 ч')).toBeTruthy();
});

test('each seat says its device and where from, by place and address key, never the address', async () => {
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/history': history([
      stay('s-guest', {
        guestName: 'Петя',
        guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        client: 'browser',
        os: 'Windows',
        browser: 'Chrome',
        ipKey: 'fedcba9876543210',
        location: 'Казань, Россия'
      })
    ])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  // The live card comes first; the history row names the room too.
  const [cardTitle] = await screen.findAllByRole('button', { name: 'Кухня' });
  if (!cardTitle) throw new Error('no room card');
  const [alicePeer, guestPeer] = within(listItemOf(cardTitle)).getAllByRole('listitem');
  if (!alicePeer || !guestPeer) throw new Error('two people expected');
  // The desktop app names only its system; a browser names system and browser.
  expect(within(alicePeer).getByText('Windows')).toBeTruthy();
  expect(within(alicePeer).getByText('Москва, Россия')).toBeTruthy();
  expect(within(alicePeer).getByText('ip·012345')).toBeTruthy();
  expect(within(guestPeer).getByText('iOS · Safari')).toBeTruthy();
  expect(within(guestPeer).getByText('#6f1c2a')).toBeTruthy();

  const row = rowsOf(await screen.findByRole('table'))[1];
  if (!row) throw new Error('no history row');
  expect(within(row).getByText('Петя')).toBeTruthy();
  expect(within(row).getByText('Windows · Chrome')).toBeTruthy();
  expect(within(row).getByText('Казань, Россия')).toBeTruthy();
  // The same address key live and in the history: the guest came from the same address.
  expect(within(row).getByText('ip·fedcba')).toBeTruthy();
});

test('a role that is not told where people came from sees only what the server sent', async () => {
  const room = kitchen();
  stubApi({
    'GET /api/admin/rooms': live([
      {
        ...room,
        peers: room.peers.map((peer) => ({ ...peer, os: '', browser: '', guestId: null, ipKey: null, location: null }))
      }
    ]),
    'GET /api/admin/rooms/history': history([stay('s-anon')])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />, 'moderator');

  const [cardTitle] = await screen.findAllByRole('button', { name: 'Кухня' });
  if (!cardTitle) throw new Error('no room card');
  const card = listItemOf(cardTitle);
  expect(within(card).getByText('Петя')).toBeTruthy();
  expect(within(card).queryByText(/ip·/)).toBeNull();
  expect(within(card).queryByText(/#/)).toBeNull();
  expect(within(card).queryByText('Москва, Россия')).toBeNull();
  expect(within(card).queryByText(/iOS/)).toBeNull();
  const row = rowsOf(await screen.findByRole('table'))[1];
  if (!row) throw new Error('no history row');
  expect(within(row).getAllByRole('cell')[4]?.textContent).toBe('');
});

test('a slow answer is waited for: the refresh does not ask again until it comes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let release: (reply: Reply) => void = () => {};
  const slow = new Promise<Reply>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  const calls = stubApi({
    'GET /api/admin/rooms': () => {
      asked += 1;
      return asked === 1 ? slow : live([]);
    },
    'GET /api/admin/rooms/history': history([])
  });
  const liveCalls = () => calls.filter((call) => call.url.pathname === '/api/admin/rooms').length;
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await waitFor(() => expect(liveCalls()).toBe(1));

  await vi.advanceTimersByTimeAsync(20_000);
  expect(liveCalls()).toBe(1);

  release(live([kitchen()]));
  expect(await screen.findByText('Петя')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(5000);
  await waitFor(() => expect(liveCalls()).toBe(2));
  expect(await screen.findByText('Сейчас никто не в звонке.')).toBeTruthy();
});

test('a room filter that could not be loaded does not stand over the stays of another room', async () => {
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/history': (url) =>
      url.searchParams.get('roomId') === 'kitchen'
        ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
        : history([stay('s-before')])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await screen.findByRole('table');

  await userEvent.click(
    within(screen.getByRole('list', { name: 'Сейчас в звонках' })).getByRole('button', { name: 'Кухня' })
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  // The old list stays, and so does the filter it was under: none.
  expect(screen.queryByRole('button', { name: /Показать все комнаты/ })).toBeNull();
  expect(rowsOf(screen.getByRole('table'))).toHaveLength(1 + 1);
});

test('a failed history load is told even when no stays are shown', async () => {
  let failing = false;
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/history': () =>
      failing ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await screen.findByText('Завершённых звонков пока нет.');

  failing = true;
  await userEvent.click(
    within(screen.getByRole('list', { name: 'Сейчас в звонках' })).getByRole('button', { name: 'Кухня' })
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Показать все комнаты/ })).toBeNull();
});
