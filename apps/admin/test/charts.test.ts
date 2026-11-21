import { cleanup, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import TimeChart from '../src/charts/TimeChart.vue';
import { stubChartBox, PLOT_WIDTH } from './helpers/chart-box.ts';
import { must } from './helpers/stats-fixtures.ts';

let restoreChartBox = () => {};
beforeEach(() => {
  restoreChartBox = stubChartBox();
});
afterEach(() => {
  cleanup();
  restoreChartBox();
});

test('a chart stacks bars, breaks lines at gaps, and shows the values under the pointer', async () => {
  const bars = render(TimeChart, {
    props: {
      title: 'Сообщения',
      kind: 'bar',
      labels: ['15.10', '16.10'],
      series: [
        { name: 'В комнатах', values: [3, 0], color: 'var(--vr-danger)' },
        { name: 'В личке', values: [1, 2], color: 'var(--vr-info)' }
      ]
    }
  });
  const drawnBars = (await screen.findByRole('img', { name: 'Сообщения' })).querySelectorAll('rect');
  // Zero draws nothing: three bars, the first two stacked at the same date.
  expect(drawnBars).toHaveLength(3);
  expect(drawnBars[0]?.getAttribute('x')).toBe(drawnBars[1]?.getAttribute('x'));
  expect(Number(drawnBars[0]?.getAttribute('y'))).toBeGreaterThan(Number(drawnBars[1]?.getAttribute('y')));
  bars.unmount();

  render(TimeChart, {
    props: {
      title: 'Процессор',
      labels: ['10:00', '10:05', '10:10', '10:15'],
      series: [{ name: 'Загрузка', values: [10, null, 30, 40], color: 'var(--vr-danger)' }],
      format: (value: number) => `${value}%`,
      note: 'Весь сервер.'
    }
  });
  const svg = await screen.findByRole('img', { name: 'Процессор' });
  const path = must(svg.querySelector('path[stroke]'), 'the line').getAttribute('d') ?? '';
  expect(path.match(/M/g)).toHaveLength(2);
  expect(screen.getByText('Весь сервер.')).toBeTruthy();

  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, PLOT_WIDTH, 180));
  const user = userEvent.setup();
  // The plot starts 44px in; the last point sits at its right edge.
  await user.pointer({ target: svg, coords: { clientX: PLOT_WIDTH - 12 } });
  const tip = screen.getByRole('status');
  expect(tip.textContent).toContain('10:15');
  expect(tip.textContent).toContain('40%');
  await user.pointer({ target: svg, coords: { clientX: 44 + (PLOT_WIDTH - 56) / 3 } });
  expect(screen.getByRole('status').textContent).toContain('—');
  await user.unhover(svg);
  expect(screen.queryByRole('status')).toBeNull();
});

test('a chart with nothing to draw says so', () => {
  render(TimeChart, { props: { title: 'Пусто', labels: [], series: [] } });
  expect(screen.getByText('Пока нет данных')).toBeTruthy();
});

test('counts get whole-number gridlines, fractions keep round ones', async () => {
  const axis = async (name: string) =>
    [...(await screen.findByRole('img', { name })).querySelectorAll('text[text-anchor="end"]')].map((node) =>
      node.textContent?.trim()
    );
  const chart = (title: string, values: number[]) =>
    render(TimeChart, {
      props: { title, labels: ['15.10', '16.10'], series: [{ name: 'Всего', values, color: 'var(--vr-danger)' }] }
    });

  const counts = chart('Аккаунты', [0, 1]);
  expect(await axis('Аккаунты')).toEqual(['0', '1', '2']);
  counts.unmount();
  const many = chart('Сообщения', [3, 37]);
  expect(await axis('Сообщения')).toEqual(['0', '20', '40']);
  many.unmount();
  chart('Часы', [0.5, 1]);
  expect(await axis('Часы')).toEqual(['0', '0,5', '1']);
});

test('a long chart names five dates, first to last, and the legend gives each latest value', async () => {
  const labels = Array.from({ length: 14 }, (_, index) => `${String(index + 1).padStart(2, '0')}.10`);
  render(TimeChart, {
    props: {
      title: 'Активность',
      labels,
      series: [
        { name: 'Активные', values: [...Array.from({ length: 13 }, () => 5), 12], color: 'var(--vr-danger)' },
        {
          name: 'Всего',
          values: [...Array.from({ length: 13 }, () => 20), null],
          color: 'var(--vr-info)',
          dashed: true
        }
      ]
    }
  });
  const svg = await screen.findByRole('img', { name: 'Активность' });
  const dates = [...svg.querySelectorAll('text[text-anchor="middle"]')].map((node) => node.textContent);
  expect(dates).toEqual(['01.10', '04.10', '08.10', '11.10', '14.10']);

  // The latest measured value: a gap at the end falls back to the one before.
  const legend = must(svg.closest('figure')?.querySelector('figcaption'), 'the caption with the legend');
  expect(legend.textContent).toMatch(/Активные\s*12/);
  expect(legend.textContent).toMatch(/Всего\s*20/);

  expect(svg.querySelectorAll('path[fill]')).toHaveLength(1);
  const lines = [...svg.querySelectorAll('path[stroke]')];
  expect(lines.map((line) => line.classList.contains('admin-chart__line--dashed'))).toEqual([false, true]);
});

test('bars draw no fill under them', async () => {
  render(TimeChart, {
    props: {
      title: 'Запросы',
      kind: 'bar',
      labels: ['1', '2'],
      series: [{ name: 'Все', values: [1, 2], color: 'var(--vr-danger)' }]
    }
  });
  const svg = await screen.findByRole('img', { name: 'Запросы' });
  expect(svg.querySelector('path[fill]')).toBeNull();
});
