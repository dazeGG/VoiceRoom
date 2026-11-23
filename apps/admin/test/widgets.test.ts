// The widgets section: today's widget numbers, the state of admission and the
// limits read only (nothing switches it from here), the widget rooms in voice
// now without an owner's column, and the history of widget calls only, which a
// participant's ip· narrows like the rooms section's.

import { cleanup, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminWidgets, LiveRoom, RoomCall, RoomCalls } from '@voiceroom/shared/contracts/admin';
import WidgetsPage from '../src/pages/WidgetsPage.vue';
import { stubApi, type Call, type Reply } from './helpers/api.ts';
import { renderAsStaff } from './helpers/render.ts';

const MINUTE = 60_000;
const IP_KEY = 'fedcba9876543210';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const widgets: AdminWidgets = {
  ok: true,
  state: {
    admissionEnabled: true,
    boundaryRequired: true,
    flagEnabled: true,
    recoveryGeneration: 3,
    owners: [
      { role: 'api', claimed: true, acknowledgedGeneration: 3 },
      { role: 'gate', claimed: true, acknowledgedGeneration: 2 }
    ]
  },
  limits: { maxRoomPeers: 12, createRateLimit: 20, createRateWindowMs: 60_000, powDifficulty: 14 },
  today: { calls: 5, guests: 12, distinctIpKeys: 9, voiceMinutes: 126 }
};

function room(roomId: string, kind: 'main' | 'widget'): LiveRoom {
  return {
    roomId,
    name: roomId,
    isStatic: false,
    avatarUrl: null,
    owner: null,
    since: Date.now() - 10 * MINUTE,
    kind,
    peers: [
      {
        peerId: `${roomId}-p`,
        name: 'Гость сайта',
        account: null,
        avatarColorKey: 'green',
        joinedAt: Date.now() - 10 * MINUTE,
        screen: false,
        client: 'browser',
        os: 'Windows',
        browser: 'Chrome',
        guestId: null,
        clientId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        ipKey: IP_KEY,
        location: 'Казань, Россия',
        network: 'bad'
      }
    ]
  };
}

const widgetCall: RoomCall = {
  id: 'c-widget',
  roomId: 'H3K9QP',
  roomName: '',
  isStatic: false,
  kind: 'widget',
  startedAt: Date.now() - 60 * MINUTE,
  endedAt: Date.now() - 40 * MINUTE,
  stays: []
};

const history = (calls: RoomCall[]): Reply => ({
  body: { ok: true, calls, next: null, keepDays: 30 } satisfies RoomCalls
});
const callRequests = (calls: Call[]) => calls.filter((one) => one.url.pathname === '/api/admin/rooms/calls');

test('the state and the limits are read only, and the numbers are of the widget rooms', async () => {
  stubApi({
    'GET /api/admin/widgets': { body: widgets },
    'GET /api/admin/rooms': { body: { ok: true, rooms: [room('P8NZ4T', 'widget'), room('kitchen', 'main')] } },
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(WidgetsPage, { props: { onOpenAccount: vi.fn(), onOpenCall: vi.fn() } });

  expect(await screen.findByText('приём включён')).toBeTruthy();
  expect(screen.getByText('WIDGET_ENABLED=true')).toBeTruthy();
  expect(screen.getByText('не снимается')).toBeTruthy();
  expect(screen.getByText('поколение 3')).toBeTruthy();
  // The gate has not confirmed the latest generation yet.
  expect(screen.getByText('ждём: gate')).toBeTruthy();
  expect(screen.getByText('20 в минуту')).toBeTruthy();
  expect(screen.getByText('сложность 14')).toBeTruthy();
  // Admission is switched by an operator on the server, never here.
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('scripts/cd/activate-widget.sh')).toBeTruthy();

  const stats = screen.getByRole('list', { name: 'Главное о виджетах' });
  expect(within(stats).getByText('12')).toBeTruthy();
  expect(within(stats).getByText('с 9 разных IP')).toBeTruthy();
  // Five finished and the one widget room going on; the app's own room is not counted.
  expect(await within(stats).findByText('5 завершены · 1 идёт')).toBeTruthy();
  expect(within(stats).getByText('1 комната виджета')).toBeTruthy();

  const live = screen.getByRole('list', { name: 'Сейчас в звонках из виджетов' });
  expect(within(live).getAllByRole('listitem')).toHaveLength(1);
  expect(within(live).getByText('P8NZ4T')).toBeTruthy();
  expect(within(live).queryByText('kitchen')).toBeNull();
  expect(screen.queryByText('Владелец')).toBeNull();
});

test('the history asks for the widget calls only, and an address narrows it', async () => {
  const calls = stubApi({
    'GET /api/admin/widgets': { body: widgets },
    'GET /api/admin/rooms': { body: { ok: true, rooms: [room('P8NZ4T', 'widget')] } },
    'GET /api/admin/rooms/calls': history([widgetCall])
  });
  const onOpenCall = vi.fn();
  renderAsStaff(WidgetsPage, { props: { onOpenAccount: vi.fn(), onOpenCall } });

  expect(await screen.findByText('H3K9QP')).toBeTruthy();
  const params = () => callRequests(calls).at(-1)?.url.searchParams;
  expect(params()?.get('kind')).toBe('widget');

  await userEvent.click(screen.getByRole('button', { name: 'Участники: P8NZ4T' }));
  const people = screen.getByRole('list', { name: 'В звонке: P8NZ4T' });
  await userEvent.click(within(people).getByRole('button', { name: 'ip·fedcba' }));
  await waitFor(() => expect(params()?.get('ipKey')).toBe(IP_KEY));
  expect(params()?.get('kind')).toBe('widget');
  await userEvent.click(await screen.findByRole('button', { name: /Снять фильтр по IP/ }));
  await waitFor(() => expect(params()?.has('ipKey')).toBe(false));

  await userEvent.click(screen.getByRole('button', { name: /^Подробно о звонке \d/ }));
  expect(onOpenCall).toHaveBeenCalledWith({ kind: 'finished', callId: 'c-widget' });
});

test('a staff member without the origin sees no codes to narrow by', async () => {
  stubApi({
    'GET /api/admin/widgets': { body: { ...widgets, state: { ...widgets.state, admissionEnabled: false } } },
    'GET /api/admin/rooms': {
      body: {
        ok: true,
        rooms: [room('P8NZ4T', 'widget')].map((one) => ({
          ...one,
          peers: one.peers.map((peer) => ({ ...peer, ipKey: null, clientId: null, location: null }))
        }))
      }
    },
    'GET /api/admin/rooms/calls': history([])
  });
  renderAsStaff(WidgetsPage, { props: { onOpenAccount: vi.fn(), onOpenCall: vi.fn() } }, 'moderator');
  expect(await screen.findByText('приём выключен')).toBeTruthy();
  await userEvent.click(await screen.findByRole('button', { name: 'Участники: P8NZ4T' }));
  const people = screen.getByRole('list', { name: 'В звонке: P8NZ4T' });
  expect(within(people).queryByRole('button', { name: /ip·|#/ })).toBeNull();
  expect(screen.getByText('Звонков из виджетов пока не было')).toBeTruthy();
});
