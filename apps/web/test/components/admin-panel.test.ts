// The admin panel: the dashboard shows the headline numbers with how they
// moved, the tabs load their own data over the span chosen (a ready-made one
// or one's own), the reports tab carries a count, a non-administrator is told
// the panel is not theirs, the header entry shows only when the lobby gives
// it, the address names the tab, and a chart draws what it is given.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AdminOverview, ProductStats, SystemStats } from '@voice-room/shared/contracts/admin';
import AdminPanel from '../../src/lib/features/admin/AdminPanel.svelte';
import TimeChart from '../../src/lib/features/admin/charts/TimeChart.svelte';
import Sparkline from '../../src/lib/features/admin/charts/Sparkline.svelte';
import {
  formatBytes,
  formatDay,
  formatPercent,
  formatSampleTime,
  formatSince
} from '../../src/lib/features/admin/format';
import { describeFiledReport } from '../../src/lib/features/admin/report-reasons';
import { adminPath, adminTabFromPath } from '../../src/lib/features/admin/tabs';
import {
  PRODUCT_PRESETS,
  SYSTEM_PRESETS,
  fromInputValue,
  moscowDay,
  productQuery,
  rangeLabel,
  systemQuery,
  toInputValue
} from '../../src/lib/features/admin/time-range';
import Sidebar from '../../src/lib/features/home/components/lobby/Sidebar.svelte';
import { LobbyStore } from '../../src/lib/features/home/model/lobby.svelte';
import { lobbyContext } from '../../src/lib/features/home/model/lobby-context';
import { prepareNotificationPreferences } from '../../src/lib/shared/notifications/preferences.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { defined, instanceOf } from '../helpers/assert.ts';

const GB = 1024 ** 3;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PLOT_WIDTH = 600;
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

beforeEach(() => {
  // jsdom lays nothing out: the chart's box gets a width, and the size binding an observer.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('chart-plot') ? PLOT_WIDTH : 0;
    }
  });
});

afterEach(() => {
  cleanup();
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

type Reply = { status?: number; body: unknown };

/** Answers the admin API by path; the query string is recorded, not matched. */
function stubAdmin(routes: Record<string, Reply | (() => Reply)>) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
      calls.push(url);
      const route = routes[url.pathname];
      const reply = typeof route === 'function' ? route() : route;
      if (!reply) return new Response(JSON.stringify({ ok: false, error: 'no stub' }), { status: 500 });
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' }
      });
    })
  );
  return calls;
}

const sample = (at: number, overrides: Partial<SystemStats['samples'][number]> = {}) => ({
  at,
  cpuPct: 12.5,
  load1: 0.4,
  memUsedBytes: 1.5 * GB,
  memTotalBytes: 4 * GB,
  diskUsedBytes: 20 * GB,
  diskTotalBytes: 80 * GB,
  dbBytes: 64 * 1024 ** 2,
  apiRssBytes: 90 * 1024 ** 2,
  eventLoopP99Ms: 4,
  wsConnections: 7,
  guestConnections: 2,
  voicePeers: 3,
  voiceRooms: 1,
  httpRequests: 120,
  http5xx: 1,
  httpAvgMs: 18,
  ...overrides
});

const overview: AdminOverview = {
  ok: true,
  live: { onlineAccounts: 5, guestConnections: 2, voicePeers: 3, voiceRooms: 1 },
  today: { day: '2026-10-16', activeAccounts: 4, newAccounts: 1, messages: 37, voiceJoins: 6, voiceMinutes: 95 },
  totals: { accounts: 24, staticRooms: 6, temporaryRooms: 30, messages: 432, weeklyActive: 9, monthlyActive: 15 },
  openReports: 2,
  livekit: true,
  version: '2.9.0',
  startedAt: Date.now() - 3 * HOUR,
  system: sample(Date.now() - 60_000, { diskUsedBytes: 75 * GB })
};

const day = (date: string, overrides: Partial<ProductStats['days'][number]> = {}) => ({
  day: date,
  activeAccounts: 0,
  desktopApp: 0,
  browser: 0,
  mobile: 0,
  newAccounts: 0,
  roomMessages: 0,
  directMessages: 0,
  messageAuthors: 0,
  staticRoomsCreated: 0,
  temporaryRoomsCreated: 0,
  voiceAccountHours: 0,
  voiceGuestHours: 0,
  voiceJoins: 0,
  voiceAccounts: 0,
  peakOnline: 0,
  peakGuests: 0,
  peakVoicePeers: 0,
  peakVoiceRooms: 0,
  ...overrides
});

const product: ProductStats = {
  ok: true,
  from: '2026-10-15',
  to: '2026-10-16',
  days: [
    day('2026-10-15', { activeAccounts: 3, newAccounts: 2, roomMessages: 30, voiceAccountHours: 2 }),
    day('2026-10-16', { activeAccounts: 4, newAccounts: 1, roomMessages: 30, directMessages: 7, voiceAccountHours: 2 })
  ],
  accountsBefore: 22,
  retention: [{ week: '2026-10-12', accounts: 3, returnedWeek1Pct: 67, returnedWeek2Pct: 0, returnedMonth1Pct: 0 }],
  trackingSince: '2026-10-15'
};

const at = Date.parse('2026-10-16T10:00:00Z');
const system: SystemStats = {
  ok: true,
  from: at - DAY,
  to: at,
  bucketSeconds: 300,
  samples: [sample(at - 300_000), sample(at)]
};

test('the dashboard shows the headline numbers, how they moved, and the server at a glance', async () => {
  const calls = stubAdmin({
    '/api/admin/overview': { body: overview },
    '/api/admin/product': { body: product },
    '/api/admin/system': { body: system }
  });
  render(AdminPanel);

  const headline = await screen.findByRole('region', { name: 'Главное' });
  const tile = (label: string) => instanceOf(within(headline).getByText(label).closest('.kpi'), HTMLElement, label);
  expect(within(tile('Онлайн сейчас')).getByText('5')).toBeTruthy();
  expect(within(tile('Онлайн сейчас')).getByText('и 2 гостевых подключений')).toBeTruthy();
  expect(within(tile('Активны сегодня')).getByText('+1 к вчера')).toBeTruthy();
  expect(within(tile('Новых за 7 дней')).getByText('3')).toBeTruthy();
  expect(within(tile('Сообщений сегодня')).getByText('+7 к вчера')).toBeTruthy();
  expect(within(tile('Часов в войсе сегодня')).getByText('без изменений')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Активность за 14 дней' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Онлайн за сутки' })).toBeTruthy();

  const server = screen.getByRole('region', { name: 'Сервер' });
  expect(within(server).getByText('LiveKit работает')).toBeTruthy();
  // 75 of 80 GB is past the warning line.
  expect(within(server).getByText('Диск').closest('.gauge')?.getAttribute('data-level')).toBe('bad');
  expect(within(server).getByText(/Версия 2\.9\.0 · работает 3 ч 0 мин/)).toBeTruthy();
  // Two weeks of days and the last day of minutes.
  const productCall = defined(
    calls.find((url) => url.pathname === '/api/admin/product'),
    'product request'
  );
  const span =
    (Date.parse(defined(productCall.searchParams.get('to'), 'to')) -
      Date.parse(defined(productCall.searchParams.get('from'), 'from'))) /
    DAY;
  expect(span).toBe(13);

  // Open reports lead to their tab.
  stubFetch({ 'GET /api/admin/reports': { body: { ok: true, reports: [] } } });
  await userEvent.click(screen.getByRole('button', { name: 'Посмотреть' }));
  expect(await screen.findByText('Открытых жалоб нет.')).toBeTruthy();
});

test('a lobby that keeps the tab is asked to switch, and the reports tab shows the count', async () => {
  stubAdmin({ '/api/admin/product': { body: product } });
  const onTabChange = vi.fn();
  render(AdminPanel, { props: { tab: 'product', onTabChange, openReports: 3 } });
  const reports = screen.getByRole('tab', { name: /Жалобы/ });
  expect(within(reports).getByLabelText('открытых: 3').textContent).toBe('3');
  await userEvent.click(reports);
  expect(onTabChange).toHaveBeenCalledWith('reports');
  // The panel stays where the lobby says until the lobby moves it.
  expect(screen.getByRole('tab', { name: 'Продукт' }).getAttribute('aria-selected')).toBe('true');
});

test('the product tab loads the last 30 days, a ready-made span reloads it, and so does one of its own', async () => {
  const calls = stubAdmin({ '/api/admin/product': { body: product } });
  render(AdminPanel, { props: { tab: 'product' } });

  expect(await screen.findByRole('img', { name: 'Активные аккаунты' })).toBeTruthy();
  const cohort = screen.getByRole('row', { name: /с 12\.10/ });
  expect(within(cohort).getByText('67%')).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Период: Последние 30 дней' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Всё время' }));
  await vi.waitFor(() => expect(calls.at(-1)?.searchParams.get('from')).toBe('2000-01-01'));
  expect(screen.getByRole('button', { name: 'Период: Всё время' })).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Период: Всё время' }));
  const dialog = await screen.findByRole('dialog', { name: 'Период' });
  const dates = within(dialog).getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
  const from = defined(dates[0], 'start date');
  const to = defined(dates[1], 'end date');
  await fireEvent.input(from, { target: { value: '2026-10-20' } });
  await fireEvent.input(to, { target: { value: '2026-10-01' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Показать' }));
  expect(within(dialog).getByRole('alert').textContent).toContain('раньше конца');

  await fireEvent.input(from, { target: { value: '2026-10-01' } });
  await fireEvent.input(to, { target: { value: '2026-10-10' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Показать' }));
  await vi.waitFor(() => expect(calls.at(-1)?.searchParams.get('to')).toBe('2026-10-10'));
  expect(calls.at(-1)?.searchParams.get('from')).toBe('2026-10-01');
  expect(screen.getByRole('button', { name: 'Период: 01.10.2026 — 10.10.2026' })).toBeTruthy();
});

test('the server tab draws the minutes over the chosen span and says when there are none', async () => {
  let empty = false;
  const calls = stubAdmin({
    '/api/admin/system': () =>
      empty ? { body: { ...system, samples: [], from: at - HOUR, bucketSeconds: 60 } } : { body: system }
  });
  render(AdminPanel, { props: { tab: 'system' } });

  expect(await screen.findByRole('img', { name: 'Процессор' })).toBeTruthy();
  expect(screen.getByText(/Сейчас: процессор 12,5%/)).toBeTruthy();
  expect(screen.getByText(/Точка — 5 мин/)).toBeTruthy();
  const first = defined(calls[0], 'first system request');
  expect(Number(first.searchParams.get('to')) - Number(first.searchParams.get('from'))).toBe(DAY);

  empty = true;
  await userEvent.click(screen.getByRole('button', { name: 'Период: Последние сутки' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Последний час' }));
  expect(await screen.findByText(/Замеров за этот период нет/)).toBeTruthy();
  const last = defined(calls.at(-1), 'last request');
  expect(Number(last.searchParams.get('to')) - Number(last.searchParams.get('from'))).toBe(HOUR);
});

test('a non-administrator is told the panel is not theirs, and a failed load can be retried', async () => {
  const denied = {
    status: 403,
    body: { ok: false, error: 'Platform administrator access required', code: 'platform_admin_required' }
  };
  stubAdmin({ '/api/admin/overview': denied, '/api/admin/product': denied, '/api/admin/system': denied });
  render(AdminPanel);
  expect(await screen.findByText('Этот раздел доступен только администратору сервиса.')).toBeTruthy();
  cleanup();

  let fail = true;
  stubAdmin({
    '/api/admin/overview': () =>
      fail ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : { body: overview },
    '/api/admin/product': { body: product },
    '/api/admin/system': { body: system }
  });
  render(AdminPanel);
  const retry = await screen.findByRole('button', { name: 'Повторить' });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole('region', { name: 'Главное' })).toBeTruthy();
});

test('the header offers the panel only when the lobby hands it the entry, with the open reports on it', async () => {
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  prepareNotificationPreferences(user.id, false, 'online');
  stubFetch({});
  const props = { user, onGoHome: vi.fn(), onOpenPeople: vi.fn(), onOpenSettings: vi.fn(), onToast: vi.fn() };
  const plain = render(Sidebar, { props, context: lobbyContext(new LobbyStore()) });
  expect(screen.queryByRole('button', { name: 'Открыть админку' })).toBeNull();
  plain.unmount();

  const onOpenAdmin = vi.fn();
  render(Sidebar, {
    props: { ...props, onOpenAdmin, adminOpen: true, adminBadge: 2 },
    context: lobbyContext(new LobbyStore())
  });
  const entry = screen.getByRole('button', { name: 'Открыть админку' });
  // Beside the logo, not in the bar at the bottom.
  expect(entry.closest('.lv-side-top')).toBeTruthy();
  expect(entry.getAttribute('aria-pressed')).toBe('true');
  expect(within(entry).getByLabelText('открытых жалоб: 2').textContent).toBe('2');
  await userEvent.click(entry);
  expect(onOpenAdmin).toHaveBeenCalledOnce();
});

test('the lobby opens the panel beside the friends list, on the tab it was given', () => {
  const lobby = new LobbyStore();
  lobby.mode = 'rooms';
  lobby.showAdmin('system');
  expect([lobby.mode, lobby.view, lobby.adminTab]).toEqual(['friends', 'admin', 'system']);
  lobby.showHome();
  lobby.showAdmin();
  expect(lobby.adminTab).toBe('system');
});

test('the address names the tab', () => {
  expect(adminTabFromPath('/admin')).toBe('overview');
  expect(adminTabFromPath('/admin/')).toBe('overview');
  expect(adminTabFromPath('/admin/reports')).toBe('reports');
  expect(adminTabFromPath('/admin/nonsense')).toBe('overview');
  expect(adminTabFromPath('/')).toBeNull();
  expect(adminTabFromPath('/administrator')).toBeNull();
  expect(adminTabFromPath('/r/admin')).toBeNull();
  expect(adminPath('overview')).toBe('/admin');
  expect(adminPath('system')).toBe('/admin/system');
});

test('a new report is described by its reason and where the message is', () => {
  expect(describeFiledReport({ reason: 'spam', targetKind: 'room_message', roomName: 'Кухня' })).toBe(
    'Спам или реклама · комната «Кухня»'
  );
  expect(describeFiledReport({ reason: 'abuse', targetKind: 'direct_message', roomName: null })).toBe(
    'Оскорбления или угрозы · личное сообщение'
  );
  expect(describeFiledReport({ reason: 'other', targetKind: 'room_message', roomName: null })).toBe(
    'Другое · временная комната'
  );
});

test('spans turn into the days and moments the server is asked for', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  expect(moscowDay(Date.parse('2026-10-15T21:30:00Z'))).toBe('2026-10-16');
  expect(productQuery({ kind: 'preset', id: '7d' }, PRODUCT_PRESETS, now)).toEqual({
    from: '2026-10-10',
    to: '2026-10-16'
  });
  expect(productQuery({ kind: 'preset', id: 'all' }, PRODUCT_PRESETS, now)).toEqual({
    from: '2000-01-01',
    to: '2026-10-16'
  });
  expect(systemQuery({ kind: 'preset', id: '3h' }, SYSTEM_PRESETS, now)).toEqual({
    from: String(now - 3 * HOUR),
    to: String(now)
  });
  expect(systemQuery({ kind: 'custom', from: 1, to: 2 }, SYSTEM_PRESETS, now)).toEqual({ from: '1', to: '2' });
  // An unknown preset falls back to a day.
  expect(systemQuery({ kind: 'preset', id: 'gone' }, SYSTEM_PRESETS, now)).toEqual({
    from: String(now - DAY),
    to: String(now)
  });
  expect(rangeLabel({ kind: 'preset', id: '6h' }, SYSTEM_PRESETS, true)).toBe('Последние 6 часов');
  expect(rangeLabel({ kind: 'preset', id: 'gone' }, SYSTEM_PRESETS, true)).toBe('gone');
  const local = new Date(2026, 9, 16, 9, 5).getTime();
  expect(toInputValue(local, true)).toBe('2026-10-16T09:05');
  expect(toInputValue(local, false)).toBe('2026-10-16');
  expect(fromInputValue('2026-10-16T09:05', true)).toBe(local);
  expect(fromInputValue('', true)).toBeNull();
  expect(fromInputValue('not a date', false)).toBeNull();
});

test('a chart stacks bars, breaks lines at gaps, and shows the values under the pointer', async () => {
  const bars = render(TimeChart, {
    props: {
      title: 'Сообщения',
      kind: 'bar',
      labels: ['15.10', '16.10'],
      series: [
        { name: 'В комнатах', values: [3, 0], color: 'red' },
        { name: 'В личке', values: [1, 2], color: 'blue' }
      ]
    }
  });
  // Zero draws nothing: three bars for three non-zero values.
  expect(bars.container.querySelectorAll('rect')).toHaveLength(3);
  bars.unmount();

  render(TimeChart, {
    props: {
      title: 'Процессор',
      labels: ['10:00', '10:05', '10:10', '10:15'],
      series: [{ name: 'Загрузка', values: [10, null, 30, 40], color: 'red' }],
      format: (value: number) => `${value}%`,
      note: 'Весь сервер.'
    }
  });
  const path = document.querySelector('path.chart-line')?.getAttribute('d');
  expect(path?.match(/M/g)).toHaveLength(2);
  expect(screen.getByText('Весь сервер.')).toBeTruthy();

  const svg = screen.getByRole('img', { name: 'Процессор' });
  svg.getBoundingClientRect = () => new DOMRect(0, 0, PLOT_WIDTH, 180);
  // The plot starts 44px in; the last point sits at its right edge.
  await fireEvent.pointerMove(svg, { clientX: PLOT_WIDTH - 12 });
  const tip = screen.getByRole('status');
  expect(tip.textContent).toContain('10:15');
  expect(tip.textContent).toContain('40%');
  await fireEvent.pointerMove(svg, { clientX: 44 + (PLOT_WIDTH - 56) / 3 });
  expect(screen.getByRole('status').textContent).toContain('—');
  await fireEvent.pointerLeave(svg);
  expect(screen.queryByRole('status')).toBeNull();
  cleanup();

  render(TimeChart, { props: { title: 'Пусто', labels: [], series: [] } });
  expect(screen.getByText('Пока нет данных')).toBeTruthy();
});

test('counts get whole-number gridlines, fractions keep round ones', () => {
  const axis = (container: HTMLElement) =>
    [...container.querySelectorAll('text.chart-axis[text-anchor="end"]')].map((node) => node.textContent?.trim());
  const counts = render(TimeChart, {
    props: { title: 'Аккаунты', labels: ['15.10', '16.10'], series: [{ name: 'Всего', values: [0, 1], color: 'red' }] }
  });
  expect(axis(counts.container)).toEqual(['0', '1', '2', '3', '4']);
  counts.unmount();
  const many = render(TimeChart, {
    props: {
      title: 'Сообщения',
      labels: ['15.10', '16.10'],
      series: [{ name: 'Всего', values: [3, 37], color: 'red' }]
    }
  });
  expect(axis(many.container)).toEqual(['0', '10', '20', '30', '40']);
  many.unmount();
  const hours = render(TimeChart, {
    props: { title: 'Часы', labels: ['15.10', '16.10'], series: [{ name: 'Всего', values: [0.5, 1], color: 'red' }] }
  });
  expect(axis(hours.container)).toEqual(['0', '0,25', '0,5', '0,75', '1']);
});

test('a sparkline draws a trend from two points and leaves a gap where a value is missing', () => {
  const drawn = render(Sparkline, { props: { values: [1, null, 3, 4], label: 'Тренд' } });
  const line = drawn.container.querySelector('path.spark-line')?.getAttribute('d');
  expect(line?.match(/M/g)).toHaveLength(2);
  expect(drawn.container.querySelector('path.spark-area')?.getAttribute('d')).toMatch(/Z$/);
  drawn.unmount();
  const flat = render(Sparkline, { props: { values: [5], label: 'Одна точка' } });
  expect(flat.container.querySelector('svg')).toBeNull();
});

test('numbers are written the Russian way', () => {
  expect(formatBytes(null)).toBe('—');
  expect(formatBytes(512)).toBe('512 Б');
  expect(formatBytes(1.5 * GB)).toBe('1,5 ГБ');
  expect(formatPercent(null)).toBe('—');
  expect(formatPercent(12.345)).toBe('12,3%');
  expect(formatDay('2026-10-05')).toBe('05.10');
  expect(formatDay('soon')).toBe('soon');
  const local = new Date(2026, 9, 16, 9, 5).getTime();
  expect(formatSampleTime(local, false)).toBe('09:05');
  expect(formatSampleTime(local, true)).toBe('16.10, 09:05');
  expect(formatSince(0, 40 * 60_000)).toBe('40 мин');
  expect(formatSince(0, (26 * 60 + 5) * 60_000)).toBe('1 дн 2 ч');
});
