// The dashboard: the headline numbers with how they moved, the server at a
// glance, the link to the open reports for those who review them, a refresh
// every half minute, and the notice when a load fails.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OverviewPage } from '../src/pages/OverviewPage.tsx';
import { StaffContext } from '../src/staff.tsx';
import { renderAs, staffOf, stubApi, type Reply } from './helpers/harness.tsx';
import { stubChartBox } from './helpers/chart-box.ts';
import { DAY, denied, must, overview, product, system } from './helpers/stats-fixtures.ts';

let restoreChartBox = () => {};
beforeEach(() => {
  restoreChartBox = stubChartBox();
});
afterEach(() => {
  cleanup();
  restoreChartBox();
});

const routes = {
  'GET /api/admin/overview': { body: overview },
  'GET /api/admin/product': { body: product },
  'GET /api/admin/system': { body: system }
};

test('the dashboard shows the headline numbers, how they moved, and the server at a glance', async () => {
  const calls = stubApi(routes);
  renderAs(<OverviewPage onOpenReports={() => {}} />);

  const headline = await screen.findByRole('region', { name: 'Главное' });
  const tile = (label: string) =>
    within(must(within(headline).getByText(label).closest<HTMLElement>('.kpi'), `the tile ${label}`));
  expect(tile('Онлайн сейчас').getByText('5')).toBeTruthy();
  expect(tile('Онлайн сейчас').getByText('и 2 гостевых подключений')).toBeTruthy();
  expect(tile('Активны сегодня').getByText('+1 к вчера')).toBeTruthy();
  expect(tile('Новых за 7 дней').getByText('3')).toBeTruthy();
  expect(tile('Сообщений сегодня').getByText('+7 к вчера')).toBeTruthy();
  expect(tile('Часов в войсе сегодня').getByText('без изменений')).toBeTruthy();
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
  stubApi(routes);
  const onOpenReports = vi.fn();
  renderAs(<OverviewPage onOpenReports={onOpenReports} />);

  const card = await screen.findByRole('status');
  expect(card.textContent).toContain('Открытых жалоб: 2');
  await userEvent.click(within(card).getByRole('button', { name: 'Посмотреть' }));
  expect(onOpenReports).toHaveBeenCalledOnce();
});

test('someone who does not review reports is not shown them, and no reports hides the card', async () => {
  stubApi(routes);
  // Every role reviews reports, so this one is given only the statistics.
  render(
    <StaffContext.Provider value={{ ...staffOf('admin'), permissions: ['stats.view'] }}>
      <OverviewPage onOpenReports={() => {}} />
    </StaffContext.Provider>
  );
  await screen.findByRole('region', { name: 'Главное' });
  expect(screen.queryByText(/Открытых жалоб/)).toBeNull();
  cleanup();

  stubApi({ ...routes, 'GET /api/admin/overview': { body: { ...overview, openReports: 0 } } });
  renderAs(<OverviewPage onOpenReports={() => {}} />);
  await screen.findByRole('region', { name: 'Главное' });
  expect(screen.queryByText(/Открытых жалоб/)).toBeNull();
});

test('a server without LiveKit or a measurement says so', async () => {
  stubApi({
    ...routes,
    'GET /api/admin/overview': { body: { ...overview, livekit: false, system: null } }
  });
  renderAs(<OverviewPage onOpenReports={() => {}} />);
  const server = await screen.findByRole('region', { name: 'Сервер' });
  expect(within(server).getByText('LiveKit выключен')).toBeTruthy();
  expect(within(server).getByText(/замеров ещё нет/)).toBeTruthy();
});

test('the dashboard asks again every half minute while it is on screen, and stops when it leaves', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const calls = stubApi(routes);
    const view = renderAs(<OverviewPage onOpenReports={() => {}} />);
    await screen.findByRole('region', { name: 'Главное' });
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
  renderAs(<OverviewPage onOpenReports={() => {}} />);
  expect(await screen.findByText('Этот раздел недоступен вашей роли.')).toBeTruthy();
  cleanup();

  let fail = true;
  stubApi({
    ...routes,
    'GET /api/admin/overview': () =>
      fail ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : { body: overview }
  });
  renderAs(<OverviewPage onOpenReports={() => {}} />);
  const retry = await screen.findByRole('button', { name: 'Повторить' });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole('region', { name: 'Главное' })).toBeTruthy();
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
    renderAs(<OverviewPage onOpenReports={() => {}} />);
    const overviewCalls = () => calls.filter((call) => call.url.pathname === '/api/admin/overview').length;
    await waitFor(() => expect(overviewCalls()).toBe(1));

    vi.advanceTimersByTime(90_000);
    expect(overviewCalls()).toBe(1);

    release({ body: overview });
    await screen.findByRole('region', { name: 'Главное' });
    vi.advanceTimersByTime(30_000);
    await waitFor(() => expect(overviewCalls()).toBe(2));
  } finally {
    vi.useRealTimers();
  }
});
