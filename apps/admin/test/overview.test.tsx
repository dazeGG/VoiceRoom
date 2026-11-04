// The dashboard: the headline numbers with how they moved, the server at a
// glance, the link to the open reports for those who review them, a refresh
// every half minute, and the notice when a load fails.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LiveRoom, LiveRoomPeer } from '@voice-room/shared/contracts/admin';
import { OverviewPage } from '../src/pages/OverviewPage.tsx';
import { StaffContext } from '../src/staff.tsx';
import { renderAs, staffOf, stubApi, type Reply } from './helpers/harness.tsx';
import { stubChartBox } from './helpers/chart-box.ts';
import { DAY, HOUR, denied, must, overview, product, system } from './helpers/stats-fixtures.ts';

let restoreChartBox = () => {};
beforeEach(() => {
  window.localStorage.clear();
  restoreChartBox = stubChartBox();
});
afterEach(() => {
  cleanup();
  restoreChartBox();
});

const NAV = { onOpenTab: vi.fn(), onOpenAccount: vi.fn(), onOpenCall: vi.fn(), onOpenLiveRoom: vi.fn() };

const routes = {
  'GET /api/admin/rooms': { body: { ok: true, rooms: [] } },
  'GET /api/admin/rooms/calls': { body: { ok: true, calls: [], next: null, keepDays: 90 } },
  'GET /api/admin/overview': { body: overview },
  'GET /api/admin/product': { body: product },
  'GET /api/admin/system': { body: system }
};

test('the dashboard shows the numbers of now and of today, how they moved, and the server at a glance', async () => {
  const calls = stubApi(routes);
  renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);

  const headline = await screen.findByRole('list', { name: 'Главное сейчас' });
  const tile = (label: string) =>
    within(must(within(headline).getByText(label).closest<HTMLElement>('.ui-stat'), `the tile ${label}`));
  expect(tile('Онлайн сейчас').getByText('5')).toBeTruthy();
  expect(tile('Онлайн сейчас').getByText('и 2 гостевых подключений')).toBeTruthy();
  expect(tile('Активны сегодня').getByText('+1 к вчера')).toBeTruthy();
  expect(tile('Новых сегодня').getByText('1')).toBeTruthy();
  expect(tile('Часов в войсе сегодня').getByText('без изменений ч к вчера')).toBeTruthy();

  // The growth stays folded until asked for.
  expect(screen.queryByRole('img', { name: 'Онлайн за сутки' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Рост и активность' }));
  expect(screen.getByRole('img', { name: 'Активность за 14 дней' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Онлайн за сутки' })).toBeTruthy();

  const server = screen.getByRole('region', { name: 'Сервер' });
  expect(within(server).getByText('LiveKit работает')).toBeTruthy();
  // 75 of 80 GB is past the warning line.
  expect(within(server).getByText('Диск').closest('.gauge')?.getAttribute('data-level')).toBe('bad');
  expect(within(server).getByText(/Версия 2\.9\.0 · работает 3 ч 0 мин/)).toBeTruthy();

  // Two weeks of days and the last day of minutes.
  const productCall = must(
    calls.find((call) => call.url.pathname === '/api/admin/product'),
    'the product request'
  );
  const from = Date.parse(must(productCall.url.searchParams.get('from'), 'from'));
  const to = Date.parse(must(productCall.url.searchParams.get('to'), 'to'));
  expect((to - from) / DAY).toBe(13);
  const systemCall = must(
    calls.find((call) => call.url.pathname === '/api/admin/system'),
    'the system request'
  );
  expect(Number(systemCall.url.searchParams.get('to')) - Number(systemCall.url.searchParams.get('from'))).toBe(DAY);
});

test('a reviewer is shown the open reports with a way to open them', async () => {
  stubApi({
    ...routes,
    'GET /api/admin/overview': {
      body: { ...overview, reports: { oldestAt: Date.now() - 5 * HOUR, reasons: ['spam', 'abuse'] } }
    }
  });
  const onOpenReports = vi.fn();
  renderAs(<OverviewPage {...NAV} onOpenReports={onOpenReports} />);

  const attention = await screen.findByRole('region', { name: 'Требует внимания' });
  expect(within(attention).getByText('Открытые жалобы')).toBeTruthy();
  expect(within(attention).getByText(/самая старая — 5 ч/)).toBeTruthy();
  await userEvent.click(within(attention).getByRole('button', { name: 'Разобрать' }));
  expect(onOpenReports).toHaveBeenCalledOnce();
});

const peer = (id: string, overrides: Partial<LiveRoomPeer> = {}): LiveRoomPeer => ({
  peerId: id,
  name: id,
  account: null,
  avatarColorKey: 'blue',
  joinedAt: Date.now() - HOUR,
  screen: false,
  client: 'browser',
  os: 'Windows',
  browser: 'Chrome',
  guestId: null,
  ipKey: null,
  location: null,
  network: 'good',
  ...overrides
});

const liveRoom = (roomId: string, name: string, peers: LiveRoomPeer[]): LiveRoom => ({
  roomId,
  name,
  isStatic: true,
  avatarUrl: null,
  owner: null,
  since: Date.now() - HOUR,
  peers
});

test('a voice worse than the norm, an overloaded client and bad answers each ask for attention', async () => {
  const onOpenLiveRoom = vi.fn();
  stubApi({
    ...routes,
    'GET /api/admin/overview': {
      body: {
        ...overview,
        openReports: 0,
        feedback: {
          day: { good: 7, bad: 2, tags: [{ tag: 'delay', count: 2 }] },
          week: { good: 41, bad: 9, tags: [{ tag: 'delay', count: 5 }] }
        }
      }
    },
    'GET /api/admin/rooms': {
      body: {
        ok: true,
        rooms: [
          liveRoom('raid', 'Рейд', [
            peer('Артём', { network: 'bad', cpuPressure: 'critical', relieved: true }),
            peer('Лиза', { network: 'unstable' })
          ]),
          liveRoom('calm', 'Лобби', [peer('Оля')])
        ]
      }
    }
  });
  renderAs(<OverviewPage {...NAV} onOpenLiveRoom={onOpenLiveRoom} onOpenReports={() => {}} />);

  const attention = await screen.findByRole('region', { name: 'Требует внимания' });
  expect(await within(attention).findByText('Рейд — 2')).toBeTruthy();
  expect(within(attention).getByText('Артём · облегчённый шумодав включён')).toBeTruthy();
  expect(within(attention).getByText('2 из 9')).toBeTruthy();

  const live = screen.getByRole('list', { name: 'Сейчас в звонках' });
  expect(within(live).getByText('2 со связью')).toBeTruthy();
  expect(within(live).getByText('связь в порядке')).toBeTruthy();
  await userEvent.click(within(live).getByRole('button', { name: /Лобби/ }));
  expect(onOpenLiveRoom).toHaveBeenCalledWith('calm');

  const answers = screen.getByRole('region', { name: 'Отзывы за 7 дней' });
  expect(within(answers).getByText('82 %')).toBeTruthy();
});

test('with nothing to look at the attention section says it is calm', async () => {
  stubApi({ ...routes, 'GET /api/admin/overview': { body: { ...overview, openReports: 0 } } });
  renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
  const attention = await screen.findByRole('region', { name: 'Требует внимания' });
  expect(within(attention).getByText('Всё спокойно')).toBeTruthy();
});

test('someone who does not review reports is not shown them, and no reports hides the card', async () => {
  stubApi(routes);
  // Every role reviews reports, so this one is given only the statistics.
  render(
    <StaffContext.Provider value={{ ...staffOf('admin'), permissions: ['stats.view'] }}>
      <OverviewPage {...NAV} onOpenReports={() => {}} />
    </StaffContext.Provider>
  );
  await screen.findByRole('list', { name: 'Главное сейчас' });
  expect(screen.queryByText('Открытые жалобы')).toBeNull();
  cleanup();

  stubApi({ ...routes, 'GET /api/admin/overview': { body: { ...overview, openReports: 0 } } });
  renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
  await screen.findByRole('list', { name: 'Главное сейчас' });
  expect(screen.queryByText('Открытые жалобы')).toBeNull();
});

test('a server without LiveKit or a measurement says so', async () => {
  stubApi({
    ...routes,
    'GET /api/admin/overview': { body: { ...overview, livekit: false, system: null } }
  });
  renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
  const server = await screen.findByRole('region', { name: 'Сервер' });
  expect(within(server).getByText('LiveKit выключен')).toBeTruthy();
  expect(within(server).getByText(/Замеров ещё нет/)).toBeTruthy();
});

test('the dashboard asks again every half minute while it is on screen, and stops when it leaves', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const calls = stubApi(routes);
    const view = renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
    await screen.findByRole('list', { name: 'Главное сейчас' });
    const overviewCalls = () => calls.filter((call) => call.url.pathname === '/api/admin/overview').length;
    expect(overviewCalls()).toBe(1);

    vi.advanceTimersByTime(30_000);
    await waitFor(() => expect(overviewCalls()).toBe(2));

    view.unmount();
    vi.advanceTimersByTime(90_000);
    expect(overviewCalls()).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test('a role the dashboard is not for is told so, and a failed load can be retried', async () => {
  stubApi({ ...routes, 'GET /api/admin/overview': denied });
  renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
  expect(await screen.findByText('Этот раздел недоступен вашей роли.')).toBeTruthy();
  cleanup();

  let fail = true;
  stubApi({
    ...routes,
    'GET /api/admin/overview': () =>
      fail ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : { body: overview }
  });
  renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
  const retry = await screen.findByRole('button', { name: 'Повторить' });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole('list', { name: 'Главное сейчас' })).toBeTruthy();
});

test('the dashboard waits for a slow answer before asking again', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    let release: (reply: Reply) => void = () => {};
    const slow = new Promise<Reply>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    const calls = stubApi({
      ...routes,
      'GET /api/admin/overview': () => {
        asked += 1;
        return asked === 1 ? slow : { body: overview };
      }
    });
    renderAs(<OverviewPage {...NAV} onOpenReports={() => {}} />);
    const overviewCalls = () => calls.filter((call) => call.url.pathname === '/api/admin/overview').length;
    await waitFor(() => expect(overviewCalls()).toBe(1));

    vi.advanceTimersByTime(90_000);
    expect(overviewCalls()).toBe(1);

    release({ body: overview });
    await screen.findByRole('list', { name: 'Главное сейчас' });
    vi.advanceTimersByTime(30_000);
    await waitFor(() => expect(overviewCalls()).toBe(2));
  } finally {
    vi.useRealTimers();
  }
});
