// The server section: the minutes over the chosen span, the note when there
// are none, and the notice on a failure.

import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { SystemPage } from '../src/pages/SystemPage.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';
import { stubChartBox } from './helpers/chart-box.ts';
import type { SystemSample } from '@voice-room/shared/contracts/admin';
import { at, DAY, denied, HOUR, must, sample, system } from './helpers/stats-fixtures.ts';

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
  // The latest minute, cell by cell.
  const now = within(screen.getByRole('list', { name: 'Сейчас' }));
  const cell = (label: string) => now.getByText(label).closest('[role="listitem"]')?.textContent ?? '';
  expect(cell('Процессор')).toContain('12,5%');
  expect(cell('Память')).toContain('1,5 ГБ из 4 ГБ');
  expect(screen.getByText(/Точка — 5 мин/)).toBeTruthy();
  expect(span(must(calls[0], 'the first request').url)).toBe(DAY);

  empty = true;
  const spans = screen.getByRole('radiogroup', { name: 'Период' });
  await userEvent.click(within(spans).getByRole('radio', { name: '1 ч' }));
  expect(await screen.findByText(/Замеров за этот период нет/)).toBeTruthy();
  expect(span(must(calls.at(-1), 'the last request').url)).toBe(HOUR);
  // The picker stays so a longer span can be chosen.
  expect(
    within(screen.getByRole('radiogroup', { name: 'Период' }))
      .getByRole('radio', { name: '1 ч' })
      .getAttribute('aria-checked')
  ).toBe('true');
});

test('the media server shows its traffic, its losses each way with too little traffic left blank, and when LiveKit was not read', async () => {
  const quiet = { sfuPacketsIn: 200, sfuLostIn: 1, sfuPacketsOut: 300, sfuLostOut: 3, sfuRetransmitOut: 0 };
  const unread = {
    sfuBytesIn: null,
    sfuBytesOut: null,
    sfuPacketsIn: null,
    sfuLostIn: null,
    sfuPacketsOut: null,
    sfuLostOut: null,
    sfuRetransmitOut: null,
    sfuCpuPct: null,
    sfuRssBytes: null,
    videoScreensMax: null,
    videoCamerasMax: null,
    videoMbpsMax: null,
    videoBudgetMbps: null,
    mediaLowered: null,
    mediaRefused: null
  };
  let latest: Partial<SystemSample> = {};
  stubApi({
    'GET /api/admin/system': () => ({
      body: { ...system, samples: [...system.samples.slice(0, -1), sample(at, latest)] }
    })
  });
  const { unmount } = renderAs(<SystemPage />);
  expect(await screen.findByRole('img', { name: 'Трафик медиасервера' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Потери пакетов' })).toBeTruthy();
  const cell = (label: string) =>
    within(screen.getByRole('list', { name: 'Сейчас' }))
      .getByText(label)
      .closest('[role="listitem"]')?.textContent ?? '';
  // 22.5 MB in a minute is 3 Mbit/s; 15 of 30 015 packets lost on the way in, 300 of 60 000 on the way out.
  expect(cell('Медиасервер')).toMatch(/↓ 3 Мбит\/с · ↑ 6 Мбит\/с/);
  expect(cell('Медиасервер')).toContain('процессор 6%, память 80 МБ');
  expect(cell('Потери медиа')).toContain('0,05% / 0,5%');
  // Video: counts only, against the budget.
  expect(cell('Видео')).toContain('12 из 550 Мбит/с');
  expect(cell('Видео')).toContain('экранов 2, камер 1');
  expect(screen.getByRole('img', { name: 'Видеотрафик' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Ограничения видео' })).toBeTruthy();
  unmount();

  latest = quiet;
  const second = renderAs(<SystemPage />);
  await screen.findByRole('img', { name: 'Потери пакетов' });
  expect(cell('Потери медиа')).toContain('— / —');
  second.unmount();

  latest = unread;
  renderAs(<SystemPage />);
  await screen.findByRole('img', { name: 'Трафик медиасервера' });
  expect(cell('Медиасервер')).toContain('LiveKit не ответил');
  expect(cell('Видео')).toContain('нет данных');
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
