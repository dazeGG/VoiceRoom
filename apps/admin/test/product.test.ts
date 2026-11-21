// The product section: the last 30 days on arrival, a ready-made span or one's
// own reloads it, the cohorts below the charts, and the notice on a failure.

import { cleanup, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import ProductPage from '../src/pages/ProductPage.vue';
import { stubApi } from './helpers/api.ts';
import { renderAsStaff } from './helpers/render.ts';
import { stubChartBox } from './helpers/chart-box.ts';
import { denied, must, product } from './helpers/stats-fixtures.ts';

let restoreChartBox = () => {};
beforeEach(() => {
  restoreChartBox = stubChartBox();
});
afterEach(() => {
  cleanup();
  restoreChartBox();
});

test('the product section loads the last 30 days, a ready-made span reloads it, and so does one of its own', async () => {
  const calls = stubApi({ 'GET /api/admin/product': { body: product } });
  renderAsStaff(ProductPage);

  expect(await screen.findByRole('img', { name: 'Активные аккаунты' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Пики онлайна за день' })).toBeTruthy();
  const cohort = screen.getByRole('row', { name: /с 12\.10/ });
  expect(within(cohort).getByText('67%')).toBeTruthy();
  expect(screen.getAllByText(/Учёт идёт с 15\.10\.2026\./).length).toBeGreaterThan(0);
  const last = () => must(calls.at(-1), 'a request').url.searchParams;

  const spans = screen.getByRole('radiogroup', { name: 'Период' });
  expect(within(spans).getByRole('radio', { name: '30 дней', checked: true })).toBeTruthy();
  await userEvent.click(within(spans).getByRole('radio', { name: 'Всё время' }));
  await waitFor(() => expect(last().get('from')).toBe('2000-01-01'));
  expect(within(spans).getByRole('radio', { name: 'Всё время', checked: true })).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  const dialog = await screen.findByRole('dialog', { name: 'Период' });
  const [from, to] = within(dialog).getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
  await userEvent.clear(must(from, 'the from field'));
  await userEvent.type(must(from, 'the from field'), '2026-10-20');
  await userEvent.clear(must(to, 'the to field'));
  await userEvent.type(must(to, 'the to field'), '2026-10-01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Показать' }));
  expect(within(dialog).getByRole('alert').textContent).toContain('раньше конца');

  await userEvent.clear(must(from, 'the from field'));
  await userEvent.type(must(from, 'the from field'), '2026-10-01');
  await userEvent.clear(must(to, 'the to field'));
  await userEvent.type(must(to, 'the to field'), '2026-10-10');
  expect(within(dialog).queryByRole('alert')).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Показать' }));
  await waitFor(() => expect(last().get('to')).toBe('2026-10-10'));
  expect(last().get('from')).toBe('2026-10-01');
  expect(screen.getByRole('button', { name: 'Свой период: 01.10.2026 — 10.10.2026' })).toBeTruthy();
  // No ready-made span is chosen while one's own is.
  expect(within(spans).queryByRole('radio', { checked: true })).toBeNull();
});

test('the cohort table says so when there are no accounts yet', async () => {
  stubApi({ 'GET /api/admin/product': { body: { ...product, retention: [] } } });
  renderAsStaff(ProductPage);
  expect(await screen.findByText('Пока нет аккаунтов.')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

test('a role the section is not for is told so, and a failed load can be retried', async () => {
  stubApi({ 'GET /api/admin/product': denied });
  renderAsStaff(ProductPage);
  expect(await screen.findByText('Этот раздел недоступен вашей роли.')).toBeTruthy();
  cleanup();

  let fail = true;
  stubApi({
    'GET /api/admin/product': () =>
      fail ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : { body: product }
  });
  renderAsStaff(ProductPage);
  const retry = await screen.findByRole('button', { name: 'Повторить' });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole('img', { name: 'Активные аккаунты' })).toBeTruthy();
});
