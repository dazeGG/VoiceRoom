// The server section: the minutes over the chosen span, the note when there
// are none, and the notice on a failure.

import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { SystemPage } from '../src/pages/SystemPage.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';
import { stubChartBox } from './helpers/chart-box.ts';
import { at, DAY, denied, HOUR, must, system } from './helpers/stats-fixtures.ts';

let restoreChartBox = () => {};
beforeEach(() => {
  restoreChartBox = stubChartBox();
});
afterEach(() => {
  cleanup();
  restoreChartBox();
});

const span = (url: URL) => Number(url.searchParams.get('to')) - Number(url.searchParams.get('from'));

test('the server section draws the minutes over the chosen span and says when there are none', async () => {
  let empty = false;
  const calls = stubApi({
    'GET /api/admin/system': () =>
      empty ? { body: { ...system, samples: [], from: at - HOUR, bucketSeconds: 60 } } : { body: system }
  });
  renderAs(<SystemPage />);

  expect(await screen.findByRole('img', { name: 'Процессор' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Запросы' })).toBeTruthy();
  expect(screen.getByText(/Сейчас: процессор 12,5%/)).toBeTruthy();
  expect(screen.getByText(/память 1,5 ГБ из 4 ГБ/)).toBeTruthy();
  expect(screen.getByText(/Точка — 5 мин/)).toBeTruthy();
  expect(span(must(calls[0], 'the first request').url)).toBe(DAY);

  empty = true;
  await userEvent.click(screen.getByRole('button', { name: 'Период: Последние сутки' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Последний час' }));
  expect(await screen.findByText(/Замеров за этот период нет/)).toBeTruthy();
  expect(span(must(calls.at(-1), 'the last request').url)).toBe(HOUR);
  // The picker stays so a longer span can be chosen.
  expect(screen.getByRole('button', { name: 'Период: Последний час' })).toBeTruthy();
});

test('a span of more than a day names the date with the time', async () => {
  stubApi({ 'GET /api/admin/system': { body: { ...system, from: at - 3 * DAY } } });
  renderAs(<SystemPage />);
  await screen.findByRole('img', { name: 'Процессор' });
  expect(document.querySelector('text.chart-axis[text-anchor="middle"]')?.textContent).toMatch(
    /\d{2}\.\d{2}, \d{2}:\d{2}/
  );
});

test('an hour-sized point is named in hours', async () => {
  stubApi({ 'GET /api/admin/system': { body: { ...system, bucketSeconds: 7200 } } });
  renderAs(<SystemPage />);
  expect(await screen.findByText(/Точка — 2 ч/)).toBeTruthy();
});

test('a role the section is not for is told so, and a failed load can be retried', async () => {
  stubApi({ 'GET /api/admin/system': denied });
  renderAs(<SystemPage />);
  expect(await screen.findByText('Этот раздел недоступен вашей роли.')).toBeTruthy();
  cleanup();

  let fail = true;
  stubApi({
    'GET /api/admin/system': () =>
      fail ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } } : { body: system }
  });
  renderAs(<SystemPage />);
  const retry = await screen.findByRole('button', { name: 'Повторить' });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole('img', { name: 'Процессор' })).toBeTruthy();
});
