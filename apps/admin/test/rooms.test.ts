// The rooms section: who is in which room's voice now (a row per room that
// opens its people: accounts by login, guests by the name they gave),
// refreshed every few seconds; an account opens its card; the finished calls
// load by day a page at a time, open to who was there and when, and narrow to
// one room or, by a click on a participant's ip· or #, to one address or
// browser; one day's timeline shows the calls on a line; each seat says what
// its role may know of where it came from.

import { cleanup, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { defineComponent, h, ref } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  LiveRoom,
  LiveRooms,
  RoomCall,
  RoomCalls,
  RoomStay,
  VoiceMinute
} from '@voice-room/shared/contracts/admin';
import RoomsPage from '../src/pages/RoomsPage.vue';
import type { HistoryRoom } from '../src/pages/rooms/history-room.ts';
import { stubApi as stubRoutes, type Call, type Reply, type Route } from './helpers/api.ts';
import { renderAsStaff } from './helpers/render.ts';

const MINUTE = 60_000;
const NEXT_PAGE = '1760000000000_6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NO_STATIC_ROOMS: Reply = {
  body: { ok: true, rooms: [], total: 0, page: 1, pageSize: 50, counts: { all: 0, active: 0, trouble: 0, quiet: 0 } }
};

/** Every test here is about the calls; the persistent rooms answer with nothing unless it says otherwise. */
const stubApi = (routes: Record<string, Route>) =>
  stubRoutes({ 'GET /api/admin/rooms/static': NO_STATIC_ROOMS, ...routes });

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
        screen: false,
        client: 'desktop_app',
        os: 'Windows',
        browser: 'VoiceRoom Desktop',
        guestId: null,
        ipKey: '0123456789abcdef',
        location: 'Москва, Россия',
        network: 'good'
      },
      {
        peerId: 'p-guest',
        name: 'Петя',
        account: null,
        avatarColorKey: 'green',
        joinedAt: Date.now() - 5 * MINUTE,
        screen: true,
        camera: true,
        client: 'mobile',
        os: 'iOS',
        browser: 'Safari',
        guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        ipKey: 'fedcba9876543210',
        location: null,
        network: 'unstable',
        cause: 'hears_badly'
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
    network: [],
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: onOpenAccount } });

  // Closed, the row sums the room up.
  const row = within(await screen.findByRole('list', { name: 'Сейчас в звонках' })).getByRole('listitem');
  expect(within(row).getByText('Кухня')).toBeTruthy();
  expect(within(row).getByText('постоянная')).toBeTruthy();
  expect(within(row).getByText('2 человека')).toBeTruthy();
  expect(within(row).getByText('@alice')).toBeTruthy();
  expect(within(row).getByLabelText('показывают экран: 1')).toBeTruthy();
  // Whose microphone or sound is off is not the panel's business.
  expect(within(row).queryByLabelText(/без микрофона|без звука/)).toBeNull();
  expect(within(row).getByLabelText('с камерой: 1')).toBeTruthy();
  expect(screen.getByText('1 комната · 2 человека')).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'В звонке: Кухня' })).toBeNull();
  expect(await screen.findByText('Завершённых звонков пока нет')).toBeTruthy();

  const people = await openLiveRoom('Кухня');
  const [alicePeer, guestPeer, ...rest] = within(people).getAllByRole('listitem');
  if (!alicePeer || !guestPeer || rest.length > 0) throw new Error('two people expected');
  expect(within(alicePeer).getByText('@alice')).toBeTruthy();
  expect(within(alicePeer).queryByText(/без микрофона|без звука/)).toBeNull();
  expect(within(guestPeer).getByText('Петя')).toBeTruthy();
  expect(within(guestPeer).getByText('гость')).toBeTruthy();
  expect(within(guestPeer).getByText('экран')).toBeTruthy();
  expect(within(guestPeer).getByText('камера')).toBeTruthy();
  expect(within(alicePeer).queryByText('камера')).toBeNull();
  // A shaky voice is said with whose side it is on, a line below; a good one says only that.
  expect(within(guestPeer).getByText('голос нестабилен')).toBeTruthy();
  expect(within(guestPeer).getByText('плохо слышит других')).toBeTruthy();
  expect(within(alicePeer).getByText('голос в порядке')).toBeTruthy();
  expect(within(alicePeer).queryByText(/слыш|задержка/)).toBeNull();
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

test('someone in the Android app shows as Android', async () => {
  const room = kitchen();
  const [alicePeer] = room.peers;
  if (!alicePeer) throw new Error('a peer expected');
  stubApi({
    'GET /api/admin/rooms': live([
      { ...room, peers: [{ ...alicePeer, client: 'mobile_app', os: 'Android', browser: 'VoiceRoom Android' }] }
    ]),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

  const people = await openLiveRoom('Кухня');
  const [peer] = within(people).getAllByRole('listitem');
  if (!peer) throw new Error('one person expected');
  expect(within(peer).getByLabelText('Android')).toBeTruthy();
});

test('the list of who is in voice refreshes every few seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let rooms: LiveRoom[] = [kitchen()];
  stubApi({
    'GET /api/admin/rooms': () => live(rooms),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  expect(within(await screen.findByRole('list', { name: 'Сейчас в звонках' })).getByText('2 человека')).toBeTruthy();

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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  expect(within(await screen.findByRole('list', { name: 'Сейчас в звонках' })).getByText('2 человека')).toBeTruthy();

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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

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
        // Pinned to today like the others: 'two hours ago' is yesterday just after midnight.
        return history([
          call('c-old', [
            stay('s-old', { account: alice, joinedAt: today - 3 * 60 * MINUTE, leftAt: today - 2 * 60 * MINUTE })
          ])
        ]);
      if (url.searchParams.get('roomId') === 'gone') return history([gone]);
      if (url.searchParams.get('roomId') === 'kitchen') return history([latest]);
      return history([latest, earlier, gone], NEXT_PAGE);
    }
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

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

test("an older stay's bar is coloured by its client's own changes, and grey where it never said", async () => {
  const startedAt = new Date(2026, 9, 15, 14, 30).getTime();
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([
      call('c-net', [
        stay('s-a', {
          account: alice,
          joinedAt: startedAt,
          leftAt: startedAt + 60 * MINUTE,
          network: [
            // The first report comes a few seconds in and stands for the start.
            { at: startedAt + 6_000, level: 'good' },
            { at: startedAt + 20 * MINUTE, level: 'unstable' },
            { at: startedAt + 25 * MINUTE, level: 'bad' },
            { at: startedAt + 30 * MINUTE, level: 'good' }
          ]
        }),
        stay('s-old', { guestName: 'Петя', joinedAt: startedAt + 10 * MINUTE, leftAt: startedAt + 50 * MINUTE })
      ])
    ])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

  await userEvent.click(await screen.findByRole('button', { name: 'Кто был в звонке 14:30–15:30' }));
  const table = screen.getByRole('table', { name: 'Участники звонка' });
  const [, aliceRow, guestRow] = within(table).getAllByRole('row');
  if (!aliceRow || !guestRow) throw new Error('two people expected');
  const stretches = (row: HTMLElement) =>
    [...row.querySelectorAll('.admin-network-span__stretch')].map((stretch) => stretch.getAttribute('title'));
  expect(stretches(aliceRow)).toEqual([
    '14:30–14:50 · голос в порядке',
    '14:50–14:55 · голос нестабилен',
    '14:55–15:00 · плохая связь',
    '15:00–15:30 · голос в порядке'
  ]);
  expect(stretches(guestRow)).toEqual(['14:40–15:20 · нет данных']);
  expect(within(table).getByText('голос нестабилен')).toBeTruthy();
});

test("a stay's bar shows its voice minute by minute with the minute's numbers, grey where none came", async () => {
  const startedAt = new Date(2026, 9, 15, 14, 30, 20).getTime();
  const minuteAt = (n: number) => new Date(2026, 9, 15, 14, 30 + n).getTime();
  const quiet = { concealedPct: 0, gapsPerMin: 0 };
  const minute = (n: number, level: 'good' | 'unstable' | 'bad' | null, extra: Partial<VoiceMinute> = {}) => ({
    at: minuteAt(n),
    level,
    polls: { good: 20, unstable: 0, bad: 0 },
    heard: quiet,
    heardBy: quiet,
    uplinkLossPct: 0,
    rttMs: 40,
    jitterBufferMs: 60,
    transport: 'udp',
    ...extra
  });
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([
      call('c-min', [
        stay('s-a', {
          account: alice,
          joinedAt: startedAt,
          leftAt: minuteAt(4) + 30_000,
          minutes: [
            // One trouble passed through: the minute stays green, and its numbers say what went on.
            minute(0, 'good', {
              polls: { good: 15, unstable: 5, bad: 0 },
              causes: { heard_badly: 0, hears_badly: 5, delay: 0 },
              heard: { concealedPct: 0.4, gapsPerMin: 6, worstConcealedPct: 6, worstGaps: 4 }
            }),
            minute(1, 'bad', {
              heardBy: { concealedPct: 21.4, gapsPerMin: 260 },
              uplinkLossPct: 18.2,
              rttMs: 310,
              transport: 'relay'
            }),
            minute(4, 'unstable', {
              heard: null,
              heardBy: null,
              uplinkLossPct: null,
              rttMs: null,
              jitterBufferMs: null
            })
          ]
        })
      ])
    ])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

  await userEvent.click(await screen.findByRole('button', { name: 'Кто был в звонке 14:30–14:34' }));
  const table = screen.getByRole('table', { name: 'Участники звонка' });
  const [, aliceRow] = within(table).getAllByRole('row');
  if (!aliceRow) throw new Error('one person expected');
  expect(
    [...aliceRow.querySelectorAll('.admin-network-span__stretch')].map((stretch) => stretch.getAttribute('title'))
  ).toEqual([
    '14:30–14:31 · голос в порядке · сбои 15 с из 60 с: плохо слышит других · слышал других: пропуски 0,4%, 6 разрывов/мин, худшие 15 с: до 6% · его слышали: пропуски 0%, 0 разрывов/мин · потери от него 0% · пинг 40 мс · буфер 60 мс',
    '14:31–14:32 · плохая связь · слышал других: пропуски 0%, 0 разрывов/мин · его слышали: пропуски 21,4%, 260 разрывов/мин · потери от него 18,2% · пинг 310 мс · буфер 60 мс · через ретранслятор',
    '14:32–14:34 · нет данных',
    '14:34–14:34 · голос нестабилен'
  ]);
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });

  const people = await openLiveRoom('Кухня');
  const [alicePeer, guestPeer] = within(people).getAllByRole('listitem');
  if (!alicePeer || !guestPeer) throw new Error('two people expected');
  // The desktop app names only its system; a browser names system and browser.
  expect(within(alicePeer).getByText('Windows · Москва, Россия')).toBeTruthy();
  expect(within(alicePeer).getByText('ip·012345')).toBeTruthy();
  expect(within(guestPeer).getByText('iOS · Safari')).toBeTruthy();
  expect(within(guestPeer).getByText('#6f1c2a')).toBeTruthy();

  await userEvent.click(await screen.findByRole('button', { name: /^Кто был в звонке/ }));
  const [, row] = within(screen.getByRole('table', { name: 'Участники звонка' })).getAllByRole('row');
  if (!row) throw new Error('no person in the call');
  expect(within(row).getByText('Петя')).toBeTruthy();
  expect(within(row).getByText('Windows · Chrome · Казань, Россия')).toBeTruthy();
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } }, 'moderator');

  const people = await openLiveRoom('Кухня');
  // Nothing to narrow the history by.
  expect(within(people).queryByRole('button', { name: /ip·|#/ })).toBeNull();
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await waitFor(() => expect(liveCalls()).toBe(1));

  await vi.advanceTimersByTimeAsync(20_000);
  expect(liveCalls()).toBe(1);

  release(live([kitchen()]));
  expect(within(await screen.findByRole('list', { name: 'Сейчас в звонках' })).getByText('2 человека')).toBeTruthy();
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await screen.findByText('Завершённых звонков пока нет');

  failing = true;
  await userEvent.click(await screen.findByRole('button', { name: 'История звонков: Кухня' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Показать все комнаты/ })).toBeNull();
});

test('a view switch that fails shows only why and a retry, not the other view as empty', async () => {
  let failing = true;
  stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) =>
      url.searchParams.has('from') && failing
        ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
        : history([call('c-before', [stay('s-before', { guestName: 'Раньше' })])])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await screen.findByRole('button', { name: /^Кто был в звонке/ });

  await userEvent.click(screen.getByRole('radio', { name: 'Лента дня' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Сегодня звонков не было')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Кто был в звонке/ })).toBeNull();

  failing = false;
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByRole('list', { name: 'Звонки за день' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
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
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
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

test("a room's picture shows in the call history and on the day's line", async () => {
  const today = new Date().setHours(1, 0, 0, 0);
  const pictured = call('c-pic', [stay('s-pic', { joinedAt: today, leftAt: today + 30 * MINUTE })], {
    avatarUrl: '/media/avatars/kitchen.webp'
  });
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([pictured])
  });
  const { container } = renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await screen.findByText('01:00–01:30');
  expect(container.querySelector('.admin-call-list__room img')?.getAttribute('src')).toBe(
    '/media/avatars/kitchen.webp'
  );

  await userEvent.click(screen.getByRole('radio', { name: 'Лента дня' }));
  const timeline = await screen.findByRole('list', { name: 'Звонки за день' });
  expect(timeline.querySelector('img')?.getAttribute('src')).toBe('/media/avatars/kitchen.webp');
});

test("the day's line goes to another day: a day back, any day on the calendar, and back to today", async () => {
  const today = new Date().setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBefore = yesterday.getTime();
  const calls = stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) => {
      const from = Number(url.searchParams.get('from'));
      return from === dayBefore
        ? history([call('c-old', [stay('s-old', { joinedAt: from + 60 * MINUTE, leftAt: from + 90 * MINUTE })])])
        : history([]);
    }
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await userEvent.click(await screen.findByRole('radio', { name: 'Лента дня' }));
  const picker = await screen.findByRole('group', { name: 'День ленты' });
  expect(within(picker).getByRole('button', { name: 'Следующий день' }).hasAttribute('disabled')).toBe(true);
  expect(within(picker).queryByRole('button', { name: 'Сегодня' })).toBeNull();
  const lastFrom = () => Number(callRequests(calls).at(-1)?.url.searchParams.get('from'));
  await waitFor(() => expect(lastFrom()).toBe(today));

  await userEvent.click(within(picker).getByRole('button', { name: 'Предыдущий день' }));
  await waitFor(() => expect(lastFrom()).toBe(dayBefore));
  const timeline = await screen.findByRole('list', { name: 'Звонки за день' });
  expect(within(timeline).getByRole('button', { name: 'Звонок 01:00–01:30, 1 человек' })).toBeTruthy();
  // What goes on now is not on yesterday's line.
  expect(within(timeline).queryByRole('button', { name: /^Идёт с / })).toBeNull();
  expect(within(picker).getByRole('button', { name: 'Следующий день' }).hasAttribute('disabled')).toBe(false);

  // Any day on the calendar; a day with nothing says so.
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateInput = within(picker).getByLabelText('День');
  await userEvent.clear(dateInput);
  await userEvent.type(dateInput, `${week.getFullYear()}-${pad(week.getMonth() + 1)}-${pad(week.getDate())}`);
  await waitFor(() => expect(lastFrom()).toBe(week.getTime()));
  expect(await screen.findByText('В этот день звонков не было')).toBeTruthy();

  await userEvent.click(within(picker).getByRole('button', { name: 'Сегодня' }));
  await waitFor(() => expect(lastFrom()).toBe(today));
  expect(await screen.findByRole('button', { name: /^Идёт с / })).toBeTruthy();
});

test('a room picked elsewhere narrows the history to it', async () => {
  const calls = stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(RoomsPage, {
    props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn(), focusRoom: { id: 'kitchen', name: 'Кухня' } }
  });
  expect(await screen.findByRole('button', { name: /Кухня/ })).toBeTruthy();
  expect(callRequests(calls).at(-1)?.url.searchParams.get('roomId')).toBe('kitchen');
});

test("a room picked elsewhere while the day's timeline is on screen narrows the timeline", async () => {
  const morning = new Date().setHours(0, 30, 0, 0);
  const calls = stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': (url) =>
      url.searchParams.has('from')
        ? history([
            call('c-morning', [stay('s-m', { guestName: 'Утром', joinedAt: morning, leftAt: morning + 45 * MINUTE })])
          ])
        : history([])
  });
  const Search = defineComponent({
    setup() {
      const room = ref<HistoryRoom | null>(null);
      return () => [
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              room.value = { id: 'kitchen', name: 'Кухня' };
            }
          },
          'Найти Кухню'
        ),
        h(RoomsPage, { focusRoom: room.value })
      ];
    }
  });
  renderAsStaff(Search);
  await screen.findByText('Завершённых звонков пока нет');
  await userEvent.click(screen.getByRole('radio', { name: 'Лента дня' }));
  const timeline = await screen.findByRole('list', { name: 'Звонки за день' });
  await userEvent.click(within(timeline).getByRole('button', { name: 'Звонок 00:30–01:15, 1 человек' }));
  expect(screen.getByRole('region', { name: 'Кухня · 00:30–01:15' })).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Найти Кухню' }));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.get('roomId')).toBe('kitchen'));
  expect(callRequests(calls).at(-1)?.url.searchParams.has('from')).toBe(true);
  expect(screen.getByRole('radio', { name: 'Лента дня', checked: true })).toBeTruthy();
  // The pick starts afresh, like any other narrowing: the call picked before closes.
  await screen.findByRole('list', { name: 'Звонки за день' });
  expect(screen.queryByRole('region', { name: 'Кухня · 00:30–01:15' })).toBeNull();
});

const CLIENT_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const IP_KEY = 'fedcba9876543210';

const ipToken = (scope: HTMLElement) => within(scope).getByRole('button', { name: `ip·${IP_KEY.slice(0, 6)}` });
const clientToken = (scope: HTMLElement) => within(scope).getByRole('button', { name: `#${CLIENT_ID.slice(0, 6)}` });

test("a participant's ip· and # narrow the history from the first page on, and the chips take them off", async () => {
  const calls = stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) =>
      history([call('c-page', [stay('s-page')])], url.searchParams.has('after') ? null : NEXT_PAGE)
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await userEvent.click(await screen.findByRole('button', { name: 'Дальше' }));
  await screen.findByText('Страница 2');
  const params = () => callRequests(calls).at(-1)?.url.searchParams;

  const people = await openLiveRoom('Кухня');
  const guest = within(people).getAllByRole('listitem')[1];
  if (!guest) throw new Error('the guest expected');
  // The full value is in the title; the short one on the button.
  expect(ipToken(guest).getAttribute('title')).toContain(IP_KEY);
  expect(clientToken(guest).getAttribute('title')).toContain(CLIENT_ID);
  await userEvent.click(ipToken(guest));
  await waitFor(() => expect(params()?.get('ipKey')).toBe(IP_KEY));
  expect(params()?.has('after')).toBe(false);
  await screen.findByText('Страница 1');
  expect(ipToken(guest).getAttribute('aria-pressed')).toBe('true');
  // Picking a filter does not fold the room it was picked in.
  expect(screen.getByRole('list', { name: 'В звонке: Кухня' })).toBeTruthy();
  await userEvent.click(clientToken(guest));
  await waitFor(() => expect(params()?.get('clientId')).toBe(CLIENT_ID));
  expect(params()?.get('ipKey')).toBe(IP_KEY);
  expect(await screen.findByRole('button', { name: /Снять фильтр по IP/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Снять фильтр по ID/ })).toBeTruthy();
  // There is no form to type them in any more.
  expect(screen.queryByRole('textbox')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }));
  await screen.findByText('Страница 2');
  expect(params()?.get('after')).toBe(NEXT_PAGE);
  expect(params()?.get('clientId')).toBe(CLIENT_ID);
  expect(params()?.get('ipKey')).toBe(IP_KEY);

  await userEvent.click(screen.getByRole('button', { name: /Снять фильтр по IP/ }));
  await waitFor(() => expect(params()?.has('ipKey')).toBe(false));
  expect(params()?.get('clientId')).toBe(CLIENT_ID);
  expect(params()?.has('after')).toBe(false);
  // Pressed again, a code takes its filter off.
  await userEvent.click(clientToken(guest));
  await waitFor(() => expect(params()?.has('clientId')).toBe(false));
  expect(screen.queryByRole('button', { name: /Снять фильтр/ })).toBeNull();
});

test('filters survive room narrowing, timeline and day changes, matching both IDs on one live peer', async () => {
  const base = kitchen();
  const first = base.peers[0];
  const second = base.peers[1];
  if (!first || !second) throw new Error('two peers required');
  const matches = {
    ...base,
    roomId: 'matches',
    name: 'Подходит',
    peers: [{ ...first, clientId: CLIENT_ID, ipKey: IP_KEY }]
  };
  const split = {
    ...base,
    roomId: 'split',
    name: 'Разные участники',
    peers: [
      { ...first, clientId: CLIENT_ID, ipKey: '0123456789abcdef' },
      { ...second, guestId: null, clientId: '11111111-1111-4111-8111-111111111111', ipKey: IP_KEY }
    ]
  };
  const calls = stubApi({
    'GET /api/admin/rooms': live([matches, split]),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await screen.findByText('Завершённых звонков пока нет');
  const people = await openLiveRoom('Подходит');
  await userEvent.click(ipToken(people));
  await userEvent.click(clientToken(people));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.get('clientId')).toBe(CLIENT_ID));
  await userEvent.click(screen.getByRole('radio', { name: 'Лента дня' }));
  const timeline = await screen.findByRole('list', { name: 'Звонки за день' });
  expect(within(timeline).getByText('Подходит')).toBeTruthy();
  expect(within(timeline).queryByText('Разные участники')).toBeNull();
  expect(within(timeline).getAllByRole('button', { name: /^Идёт с / })).toHaveLength(1);
  const params = () => callRequests(calls).at(-1)?.url.searchParams;
  expect(params()?.get('clientId')).toBe(CLIENT_ID);
  expect(params()?.get('ipKey')).toBe(IP_KEY);
  expect(params()?.has('from')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Предыдущий день' }));
  await screen.findByText('В этот день звонков не было');
  expect(params()?.get('clientId')).toBe(CLIENT_ID);
  expect(params()?.get('ipKey')).toBe(IP_KEY);
  await userEvent.click(within(liveTable()).getByRole('button', { name: 'История звонков: Подходит' }));
  await waitFor(() => expect(params()?.get('roomId')).toBe('matches'));
  expect(params()?.get('clientId')).toBe(CLIENT_ID);
  await userEvent.click(screen.getByRole('radio', { name: 'Звонки' }));
  await screen.findByText('Завершённых звонков пока нет');
  expect(params()?.get('clientId')).toBe(CLIENT_ID);
  expect(params()?.has('from')).toBe(false);
});

test('an address someone else in the call came from too is marked on both', async () => {
  const room = kitchen();
  const [first, second] = room.peers;
  if (!first || !second) throw new Error('two peers required');
  stubApi({
    'GET /api/admin/rooms': live([{ ...room, peers: [first, { ...second, ipKey: first.ipKey }] }]),
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  const people = await openLiveRoom('Кухня');
  for (const peer of within(people).getAllByRole('listitem')) {
    expect(within(peer).getByRole('button', { name: 'ip·012345' }).getAttribute('title')).toContain(
      'тот же IP у другого участника'
    );
  }
});

test('a call row opens its people, the arrow its page, and a filtered row names who matched', async () => {
  const startedAt = new Date(2026, 9, 15, 14, 30).getTime();
  const guest = stay('s-guest', {
    guestName: 'Петя',
    guestId: CLIENT_ID,
    clientId: CLIENT_ID,
    ipKey: IP_KEY,
    joinedAt: startedAt,
    leftAt: startedAt + 20 * MINUTE
  });
  const other = stay('s-other', {
    guestName: 'Оля',
    ipKey: '0123456789abcdef',
    joinedAt: startedAt + 5 * MINUTE,
    leftAt: startedAt + 20 * MINUTE
  });
  const onOpenCall = vi.fn();
  stubApi({
    'GET /api/admin/rooms': live([]),
    'GET /api/admin/rooms/calls': history([
      call('c-widget', [guest, other], { roomId: 'P8NZ4T', roomName: '', isStatic: false, kind: 'widget' })
    ])
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: onOpenCall, onOpenAccount: vi.fn() } });

  const row = (await screen.findByText('14:30–14:50')).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error('the call row expected');
  expect(within(row).getByText('виджет')).toBeTruthy();
  expect(within(row).queryByText('временная')).toBeNull();
  // A click on the row opens the people, not the call's page.
  await userEvent.click(within(row).getByText('14:30–14:50'));
  expect(screen.getByRole('table', { name: 'Участники звонка' })).toBeTruthy();
  expect(onOpenCall).not.toHaveBeenCalled();
  await userEvent.click(within(row).getByRole('button', { name: 'Подробно о звонке 14:30–14:50' }));
  expect(onOpenCall).toHaveBeenCalledWith({ kind: 'finished', callId: 'c-widget' });

  // Narrowed to the guest's address from the call's own people, the row names them.
  const table = screen.getByRole('table', { name: 'Участники звонка' });
  await userEvent.click(ipToken(table));
  expect(await within(row).findByText('совпадение: Петя')).toBeTruthy();
});

test('the widget calls of today show beside the other numbers', async () => {
  const room = kitchen();
  stubApi({
    'GET /api/admin/rooms': live([room, { ...room, roomId: 'P8NZ4T', name: 'P8NZ4T', kind: 'widget' }]),
    'GET /api/admin/rooms/calls': history([]),
    'GET /api/admin/overview': {
      body: {
        ok: true,
        live: { onlineAccounts: 0, guestConnections: 0, voicePeers: 0, voiceRooms: 0 },
        today: {
          day: '2026-11-19',
          activeAccounts: 0,
          newAccounts: 0,
          messages: 0,
          voiceJoins: 0,
          voiceMinutes: 0,
          calls: 9,
          callsYesterday: 4,
          widgetCalls: 6,
          widgetGuests: 10
        },
        totals: { accounts: 0, staticRooms: 0, temporaryRooms: 0, messages: 0, weeklyActive: 0, monthlyActive: 0 },
        openReports: 0,
        livekit: true,
        version: 'test',
        startedAt: 0,
        system: null
      }
    }
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  const stats = await screen.findByRole('list', { name: 'Главное о комнатах' });
  const widgets = await within(stats).findByText('Из виджетов сегодня');
  const cell = widgets.closest('[role="listitem"]');
  if (!(cell instanceof HTMLElement)) throw new Error('the widgets cell expected');
  expect(within(cell).getByText('7')).toBeTruthy();
  expect(within(cell).getByText('1 идёт · 12 гостей')).toBeTruthy();
  // The live widget room says what it is.
  expect(within(liveTable()).getByText('виджет')).toBeTruthy();
  // Yesterday's count is no longer over the history.
  expect(screen.queryByText(/вчера 4/)).toBeNull();
});

test('clearing a filter drops its late response and keeps the newer unfiltered calls', async () => {
  let release: (reply: Reply) => void = () => {};
  const pending = new Promise<Reply>((resolve) => {
    release = resolve;
  });
  const calls = stubApi({
    'GET /api/admin/rooms': live([kitchen()]),
    'GET /api/admin/rooms/calls': (url) => (url.searchParams.has('clientId') ? pending : history([]))
  });
  renderAsStaff(RoomsPage, { props: { onOpenCall: vi.fn(), onOpenAccount: vi.fn() } });
  await screen.findByText('Завершённых звонков пока нет');
  const people = await openLiveRoom('Кухня');
  await userEvent.click(clientToken(people));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.get('clientId')).toBe(CLIENT_ID));
  await userEvent.click(clientToken(people));
  await waitFor(() => expect(callRequests(calls).at(-1)?.url.searchParams.has('clientId')).toBe(false));
  release(history([call('c-late', [stay('s-late', { roomName: 'Устаревшая комната' })])]));
  // Let the released fetch and JSON decoding settle before checking that its answer was ignored.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('Устаревшая комната')).toBeNull();
  expect(screen.getByText('Завершённых звонков пока нет')).toBeTruthy();
});
