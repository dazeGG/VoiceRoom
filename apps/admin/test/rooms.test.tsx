// The rooms section: who is in which room's voice now (a row per room that
// opens its people: accounts by login, guests by the name they gave),
// refreshed every few seconds; an account opens its card; the finished calls
// load by day a page at a time, open to who was there and when, and narrow to
// one room; one day's timeline shows the calls on a line; each seat says what
// its role may know of where it came from.

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { LiveRoom, LiveRooms, RoomCall, RoomCalls, RoomStay } from '@voice-room/shared/contracts/admin';
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

/** A call around its stays: from the first in to the last out, in the room of the first. */
function call(id: string, stays: RoomStay[], overrides: Partial<RoomCall> = {}): RoomCall {
  const first = stays[0] ?? stay(`${id}-s`);
  return {
    id,
    roomId: first.roomId,
    roomName: first.roomName,
    isStatic: first.isStatic,
    startedAt: Math.min(...stays.map((one) => one.joinedAt)),
    endedAt: Math.max(...stays.map((one) => one.leftAt)),
    stays,
    ...overrides
  };
}

const live = (rooms: LiveRoom[]): Reply => ({ body: { ok: true, rooms } satisfies LiveRooms });
const history = (calls: RoomCall[], next: string | null = null): Reply => ({
  body: { ok: true, calls, next, keepDays: 90 } satisfies RoomCalls
});

const callRequests = (calls: Call[]) => calls.filter((one) => one.url.pathname === '/api/admin/rooms/calls');

const liveTable = () => screen.getByRole('list', { name: 'Сейчас в звонках' });

async function openLiveRoom(name: string): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: `Участники: ${name}` }));
  return screen.getByRole('list', { name: `В звонке: ${name}` });
}

test('a live room opens its people: accounts by login, guests by name, and an account opens its card', async () => {
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': history([])
  });
  const onOpenAccount = vi.fn();
  renderAs(<RoomsPage onOpenAccount={onOpenAccount} />);

  // Closed, the row sums the room up.
  const row = within(await screen.findByRole('list', { name: 'Сейчас в звонках' })).getByRole('listitem');
  expect(within(row).getByText('Кухня')).toBeTruthy();
  expect(within(row).getByText('постоянная')).toBeTruthy();
  expect(within(row).getByText('2 человека')).toBeTruthy();
  expect(within(row).getByText('@alice')).toBeTruthy();
  expect(within(row).getByLabelText('показывают экран: 1')).toBeTruthy();
  expect(within(row).getByLabelText('без микрофона: 1')).toBeTruthy();
  expect(screen.getByText('1 комната · 2 человека')).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'В звонке: Кухня' })).toBeNull();
  expect(await screen.findByText('Завершённых звонков пока нет')).toBeTruthy();

  const people = await openLiveRoom('Кухня');
  const [alicePeer, guestPeer, ...rest] = within(people).getAllByRole('listitem');
  if (!alicePeer || !guestPeer || rest.length > 0) throw new Error('two people expected');
  expect(within(alicePeer).getByText('@alice')).toBeTruthy();
  expect(within(alicePeer).getByText('без микрофона')).toBeTruthy();
  expect(within(guestPeer).getByText('Петя')).toBeTruthy();
  expect(within(guestPeer).getByText('гость')).toBeTruthy();
  expect(within(guestPeer).getByText('экран')).toBeTruthy();
  // Where each one sits: the desktop app, a phone or a browser.
  expect(within(alicePeer).getByLabelText('приложение')).toBeTruthy();
  expect(within(guestPeer).getByLabelText('телефон')).toBeTruthy();

  await userEvent.click(within(alicePeer).getByRole('button', { name: /Алиса/ }));
  expect(onOpenAccount).toHaveBeenCalledWith('u-alice');
  // Opening a card did not fold the room.
  expect(screen.getByRole('list', { name: 'В звонке: Кухня' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Участники: Кухня' }));
  expect(screen.queryByRole('list', { name: 'В звонке: Кухня' })).toBeNull();
});

test('the list of who is in voice refreshes every few seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let rooms: LiveRoom[] = [kitchen()];
  stubApi({
    'GET /api/admin/rooms': () => live(rooms),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  expect(await screen.findByText('2 человека')).toBeTruthy();

  rooms = [];
  await vi.advanceTimersByTimeAsync(5000);
  expect(await screen.findByText('Сейчас никто не в звонке')).toBeTruthy();
});

test('a failed refresh keeps the rooms already shown and says why', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let failing = false;
  stubApi({
    'GET /api/admin/rooms': () =>
      failing ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : live([kitchen()]),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  expect(await screen.findByText('2 человека')).toBeTruthy();

  failing = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(within(liveTable()).getByText('Кухня')).toBeTruthy();
});

test('an unnamed temporary room that is still there goes by its code and is not marked deleted', async () => {
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([
      call('c-tmp', [stay('s-tmp', { roomId: '8vjx8udrdu', roomName: '', isStatic: false })])
    ])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  const room = await screen.findByRole('button', { name: /8vjx8udrdu/ });
  expect(within(room).getByText('временная')).toBeTruthy();
  expect(within(room).queryByText('удалена')).toBeNull();
});

test('the calls come by day, a page at a time, and narrow to one room', async () => {
  const today = new Date().setHours(9, 0, 0, 0);
  const yesterday = today - 24 * 60 * MINUTE;
  const latest = call('c-1', [stay('s-1', { joinedAt: today, leftAt: today + 30 * MINUTE })]);
  const earlier = call('c-2', [stay('s-2', { joinedAt: today - 60 * MINUTE, leftAt: today - 30 * MINUTE })]);
  const gone = call('c-gone', [
    stay('s-gone', { roomId: 'gone', roomName: null, joinedAt: yesterday, leftAt: yesterday + MINUTE })
  ]);
  const calls = stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) => {
      if (url.searchParams.get('after') === NEXT_PAGE)
        return history([call('c-old', [stay('s-old', { account: alice })])]);
      if (url.searchParams.get('roomId') === 'gone') return history([gone]);
      if (url.searchParams.get('roomId') === 'kitchen') return history([latest]);
      return history([latest, earlier, gone], NEXT_PAGE);
    }
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  // Today's two calls under today, the call in the room that is gone under yesterday.
  const todays = await screen.findByRole('region', { name: /^Сегодня, / });
  expect(within(todays).getAllByRole('listitem')).toHaveLength(2);
  expect(within(todays).getByText('2 звонка · 1 ч')).toBeTruthy();
  const yesterdays = screen.getByRole('region', { name: /^Вчера, / });
  expect(within(yesterdays).getByText('удалена')).toBeTruthy();
  expect(within(yesterdays).getByText('gone')).toBeTruthy();

  // The next page replaces this one; going back asks for the first page again.
  expect(screen.getByRole('button', { name: 'Назад' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }));
  expect(await screen.findByText('Страница 2')).toBeTruthy();
  expect(screen.queryByRole('region', { name: /^Вчера, / })).toBeNull();
  expect(screen.getByRole('button', { name: 'Дальше' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Назад' }));
  expect(await screen.findByText('Страница 1')).toBeTruthy();
  expect(callRequests(calls).at(-1)?.url.searchParams.has('after')).toBe(false);

  // A live room's history button narrows the list; the chip takes it back to every room.
  await userEvent.click(within(liveTable()).getByRole('button', { name: 'История звонков: Кухня' }));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.get('roomId')).toBe('kitchen'));
  expect(await screen.findByRole('button', { name: /Показать все комнаты/ })).toBeTruthy();
  // The history button does not open the live room.
  expect(screen.queryByRole('list', { name: 'В звонке: Кухня' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Показать все комнаты/ }));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.has('roomId')).toBe(false));

  // So does a room in the history, a gone one too.
  await userEvent.click(await screen.findByRole('button', { name: /gone/ }));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.get('roomId')).toBe('gone'));
});

test('a call shows its span and length, and opens to who was there and when', async () => {
  const startedAt = new Date(2026, 9, 15, 14, 30).getTime();
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([
      call('c-long', [
        stay('s-a', { account: alice, joinedAt: startedAt, leftAt: startedAt + 40 * MINUTE }),
        stay('s-guest', { guestName: 'Петя', joinedAt: startedAt + 10 * MINUTE, leftAt: startedAt + 85 * MINUTE }),
        // Alice came back: one person, two times in the call.
        stay('s-a2', { account: alice, joinedAt: startedAt + 60 * MINUTE, leftAt: startedAt + 80 * MINUTE })
      ])
    ])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  expect(await screen.findByText('14:30–15:55')).toBeTruthy();
  expect(screen.getByText('1 ч 25 мин')).toBeTruthy();
  expect(screen.getByText('2 человека')).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Кто был в звонке 14:30–15:55' }));
  const table = screen.getByRole('table', { name: 'Участники звонка' });
  const [, aliceRow, guestRow] = within(table).getAllByRole('row');
  if (!aliceRow || !guestRow) throw new Error('two people expected');
  expect(within(aliceRow).getByLabelText('14:30–15:10, 15:30–15:50')).toBeTruthy();
  expect(within(aliceRow).getByText('1 ч')).toBeTruthy();
  expect(within(guestRow).getByText('Петя')).toBeTruthy();
  expect(within(guestRow).getByText('1 ч 15 мин')).toBeTruthy();
});

test('each seat says its device and where from, by place and address key, never the address', async () => {
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': history([
      call('c-guest', [
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
    ])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);

  const people = await openLiveRoom('Кухня');
  const [alicePeer, guestPeer] = within(people).getAllByRole('listitem');
  if (!alicePeer || !guestPeer) throw new Error('two people expected');
  // The desktop app names only its system; a browser names system and browser.
  expect(within(alicePeer).getByText('Windows')).toBeTruthy();
  expect(within(alicePeer).getByText('Москва, Россия')).toBeTruthy();
  expect(within(alicePeer).getByText('ip·012345')).toBeTruthy();
  expect(within(guestPeer).getByText('iOS · Safari')).toBeTruthy();
  expect(within(guestPeer).getByText('#6f1c2a')).toBeTruthy();

  await userEvent.click(await screen.findByRole('button', { name: /^Кто был в звонке/ }));
  const [, row] = within(screen.getByRole('table', { name: 'Участники звонка' })).getAllByRole('row');
  if (!row) throw new Error('no person in the call');
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
    'GET /api/admin/rooms/calls': history([call('c-anon', [stay('s-anon')])])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />, 'moderator');

  const people = await openLiveRoom('Кухня');
  expect(within(people).getByText('Петя')).toBeTruthy();
  expect(within(people).queryByText(/ip·/)).toBeNull();
  expect(within(people).queryByText(/#/)).toBeNull();
  expect(within(people).queryByText('Москва, Россия')).toBeNull();
  expect(within(people).queryByText(/iOS/)).toBeNull();
  // The kind of client is no secret.
  expect(within(people).getByLabelText('телефон')).toBeTruthy();

  await userEvent.click(await screen.findByRole('button', { name: /^Кто был в звонке/ }));
  const [, row] = within(screen.getByRole('table', { name: 'Участники звонка' })).getAllByRole('row');
  expect(row && within(row).getAllByRole('cell')[3]?.textContent).toBe('');
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
    'GET /api/admin/rooms/calls': history([])
  });
  const liveCalls = () => calls.filter((one) => one.url.pathname === '/api/admin/rooms').length;
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await waitFor(() => expect(liveCalls()).toBe(1));

  await vi.advanceTimersByTimeAsync(20_000);
  expect(liveCalls()).toBe(1);

  release(live([kitchen()]));
  expect(await screen.findByText('2 человека')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(5000);
  await waitFor(() => expect(liveCalls()).toBe(2));
  expect(await screen.findByText('Сейчас никто не в звонке')).toBeTruthy();
});

test('a room filter that could not be loaded does not stand over the calls of another room', async () => {
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) =>
      url.searchParams.get('roomId') === 'kitchen'
        ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
        : history([call('c-before', [stay('s-before', { guestName: 'Раньше' })])])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await screen.findByRole('button', { name: /^Кто был в звонке/ });

  await userEvent.click(within(liveTable()).getByRole('button', { name: 'История звонков: Кухня' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  // The old list stays, and so does the filter it was under: none.
  expect(screen.queryByRole('button', { name: /Показать все комнаты/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^Кто был в звонке/ })).toBeTruthy();
});

test('a failed history load is told even when no calls are shown', async () => {
  let failing = false;
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': () =>
      failing ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await screen.findByText('Завершённых звонков пока нет');

  failing = true;
  await userEvent.click(await screen.findByRole('button', { name: 'История звонков: Кухня' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Показать все комнаты/ })).toBeNull();
});

test("the day's timeline asks for today's calls, and a call's bar shows who was in it", async () => {
  const morning = new Date().setHours(0, 30, 0, 0);
  const calls = stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) =>
      url.searchParams.has('from')
        ? history([
            call('c-morning', [
              stay('s-m', { guestName: 'Утром', joinedAt: morning, leftAt: morning + 45 * MINUTE }),
              stay('s-m2', { guestName: 'Тоже', joinedAt: morning + 5 * MINUTE, leftAt: morning + 40 * MINUTE })
            ])
          ])
        : history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} />);
  await screen.findByText('Завершённых звонков пока нет');

  await userEvent.click(screen.getByRole('radio', { name: 'Лента дня' }));
  const timeline = await screen.findByRole('list', { name: 'Звонки за день' });
  const request = callRequests(calls).at(-1)?.url;
  const from = Number(request?.searchParams.get('from'));
  expect(from).toBe(new Date().setHours(0, 0, 0, 0));
  expect(Number(request?.searchParams.get('to')) - from).toBe(24 * 60 * MINUTE);

  // The live room is on the line too, still going.
  expect(within(timeline).getByRole('button', { name: /^Идёт с / })).toBeTruthy();
  await userEvent.click(within(timeline).getByRole('button', { name: 'Звонок 00:30–01:15, 2 человека' }));
  const card = screen.getByRole('region', { name: 'Кухня · 00:30–01:15' });
  expect(within(card).getByText('Утром')).toBeTruthy();
  expect(within(card).getByText('Тоже')).toBeTruthy();
});

test('a room picked elsewhere narrows the history to it', async () => {
  const calls = stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAs(<RoomsPage onOpenAccount={vi.fn()} focusRoom={{ id: 'kitchen', name: 'Кухня' }} />);
  expect(await screen.findByRole('button', { name: /Кухня/ })).toBeTruthy();
  expect(callRequests(calls).at(-1)?.url.searchParams.get('roomId')).toBe('kitchen');
});
