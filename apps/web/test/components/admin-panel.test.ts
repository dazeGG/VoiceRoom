// The admin panel: the overview shows the server's numbers, the tabs load
// their own data and a period reloads it, a non-administrator is told the
// panel is not theirs, the sidebar entry shows only when the lobby gives it,
// and a chart draws what it is given.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AdminOverview, ProductStats, SystemStats } from '@voice-room/shared/contracts/admin';
import AdminPanel from '../../src/lib/features/admin/AdminPanel.svelte';
import TimeChart from '../../src/lib/features/admin/charts/TimeChart.svelte';
import {
  formatBytes,
  formatDay,
  formatPercent,
  formatSampleTime,
  formatSince
} from '../../src/lib/features/admin/format';
import Sidebar from '../../src/lib/features/home/components/lobby/Sidebar.svelte';
import { LobbyStore } from '../../src/lib/features/home/model/lobby.svelte';
import { lobbyContext } from '../../src/lib/features/home/model/lobby-context';
import { prepareNotificationPreferences } from '../../src/lib/shared/notifications/preferences.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';

const GB = 1024 ** 3;
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
  startedAt: Date.now() - 3 * 60 * 60 * 1000,
  system: sample(Date.now() - 60_000)
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

const product = (range: string): ProductStats => ({
  ok: true,
  range,
  days: [day('2026-10-15', { activeAccounts: 3, newAccounts: 2 }), day('2026-10-16', { activeAccounts: 4 })],
  accountsBefore: 22,
  retention: [{ week: '2026-10-12', accounts: 3, returnedWeek1Pct: 67, returnedWeek2Pct: 0, returnedMonth1Pct: 0 }],
  trackingSince: '2026-10-15'
});

test('the overview shows what is happening now, today, in total and on the server', async () => {
  stubFetch({ 'GET /api/admin/overview': { body: overview } });
  render(AdminPanel);

  const now = await screen.findByRole('region', { name: 'Сейчас' });
  expect(within(now).getByText('аккаунтов онлайн').previousElementSibling?.textContent).toBe('5');
  const today = screen.getByRole('region', { name: 'Сегодня' });
  expect(within(today).getByText('минут в войсе').previousElementSibling?.textContent).toBe('95');
  const totals = screen.getByRole('region', { name: 'Всего' });
  expect(within(totals).getByText('временных комнат').previousElementSibling?.textContent).toBe('30');
  const server = screen.getByRole('region', { name: 'Сервер' });
  expect(within(server).getByText('память').previousElementSibling?.textContent).toBe('37,5%');
  expect(within(server).getByText('1,5 ГБ из 4 ГБ')).toBeTruthy();
  expect(within(server).getByText(/Версия 2\.9\.0, работает 3 ч 0 мин, замер 1 мин назад/)).toBeTruthy();

  // Open reports lead to their tab.
  stubFetch({ 'GET /api/admin/reports': { body: { ok: true, reports: [] } } });
  await userEvent.click(screen.getByRole('button', { name: 'Посмотреть' }));
  expect(await screen.findByText('Открытых жалоб нет.')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Жалобы' }).getAttribute('aria-selected')).toBe('true');
});

test('the product tab loads its range, a new period reloads it, and the cohorts are listed', async () => {
  const { calls } = stubFetch({
    'GET /api/admin/product?range=30d': { body: product('30d') },
    'GET /api/admin/product?range=7d': { body: product('7d') }
  });
  render(AdminPanel, { props: { tab: 'product' } });

  expect(await screen.findByRole('img', { name: 'Активные аккаунты' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Аккаунты' })).toBeTruthy();
  expect(screen.getAllByText(/Учёт идёт с 15\.10\.2026/).length).toBeGreaterThan(0);
  const cohort = screen.getByRole('row', { name: /с 12\.10/ });
  expect(within(cohort).getByText('67%')).toBeTruthy();

  await userEvent.click(screen.getByRole('radio', { name: '7 дней' }));
  await vi.waitFor(() => expect(calls.map((call) => call.url)).toContain('/api/admin/product?range=7d'));
  expect(screen.getByRole('radio', { name: '7 дней' }).getAttribute('aria-checked')).toBe('true');
});

test('the server tab draws the minutes it is given and says when there are none', async () => {
  const at = Date.parse('2026-10-16T10:00:00Z');
  stubFetch({
    'GET /api/admin/system?range=24h': {
      body: { ok: true, range: '24h', bucketSeconds: 300, samples: [sample(at), sample(at + 300_000)] }
    },
    'GET /api/admin/system?range=6h': { body: { ok: true, range: '6h', bucketSeconds: 60, samples: [] } }
  });
  render(AdminPanel, { props: { tab: 'system' } });

  expect(await screen.findByRole('img', { name: 'Процессор' })).toBeTruthy();
  expect(screen.getByText(/Сейчас: процессор 12,5%/)).toBeTruthy();
  expect(screen.getByText(/Точка — 5 мин/)).toBeTruthy();

  await userEvent.click(screen.getByRole('radio', { name: '6 часов' }));
  expect(await screen.findByText(/Замеров за этот период нет/)).toBeTruthy();
});

test('a non-administrator is told the panel is not theirs, and a failed load can be retried', async () => {
  stubFetch({
    'GET /api/admin/overview': {
      status: 403,
      body: { ok: false, error: 'Platform administrator access required', code: 'platform_admin_required' }
    }
  });
  render(AdminPanel);
  expect(await screen.findByText('Этот раздел доступен только администратору сервиса.')).toBeTruthy();
  cleanup();

  let fail = true;
  stubFetch({
    'GET /api/admin/overview': () =>
      fail ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : { body: overview }
  });
  render(AdminPanel);
  const retry = await screen.findByRole('button', { name: 'Повторить' });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole('region', { name: 'Сейчас' })).toBeTruthy();
});

test('the sidebar offers the panel only when the lobby hands it the entry', async () => {
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  prepareNotificationPreferences(user.id, false, 'online');
  stubFetch({});
  const props = { user, onGoHome: vi.fn(), onOpenPeople: vi.fn(), onOpenSettings: vi.fn(), onToast: vi.fn() };
  const plain = render(Sidebar, { props, context: lobbyContext(new LobbyStore()) });
  expect(screen.queryByRole('button', { name: 'Открыть админку' })).toBeNull();
  plain.unmount();

  const onOpenAdmin = vi.fn();
  render(Sidebar, { props: { ...props, onOpenAdmin, adminOpen: true }, context: lobbyContext(new LobbyStore()) });
  const entry = screen.getByRole('button', { name: 'Открыть админку' });
  expect(entry.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(entry);
  expect(onOpenAdmin).toHaveBeenCalledOnce();
});

test('the lobby opens the panel beside the friends list', () => {
  const lobby = new LobbyStore();
  lobby.mode = 'rooms';
  lobby.showAdmin();
  expect([lobby.mode, lobby.view]).toEqual(['friends', 'admin']);
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
  const path = document.querySelector('path.chart-line')!.getAttribute('d')!;
  expect(path.match(/M/g)).toHaveLength(2);
  expect(screen.getByText('Весь сервер.')).toBeTruthy();

  const svg = screen.getByRole('img', { name: 'Процессор' });
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: PLOT_WIDTH, height: 180 }) as DOMRect;
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

test('numbers are written the Russian way', () => {
  expect(formatBytes(null)).toBe('—');
  expect(formatBytes(512)).toBe('512 Б');
  expect(formatBytes(1.5 * GB)).toBe('1,5 ГБ');
  expect(formatPercent(null)).toBe('—');
  expect(formatPercent(12.345)).toBe('12,3%');
  expect(formatDay('2026-10-05')).toBe('05.10');
  expect(formatDay('soon')).toBe('soon');
  const at = new Date(2026, 9, 16, 9, 5).getTime();
  expect(formatSampleTime(at, false)).toBe('09:05');
  expect(formatSampleTime(at, true)).toBe('16.10, 09:05');
  expect(formatSince(0, 40 * 60_000)).toBe('40 мин');
  expect(formatSince(0, (26 * 60 + 5) * 60_000)).toBe('1 дн 2 ч');
});
