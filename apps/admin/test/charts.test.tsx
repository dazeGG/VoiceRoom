// The charts draw what they are given: stacked bars, lines broken at gaps,
// round gridlines, five dates under the plot, a fill under the first line, a
// dashed limit, each series' latest value, the values under the pointer, and
// a sparkline's trend.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Sparkline } from '../src/charts/Sparkline.tsx';
import { TimeChart } from '../src/charts/TimeChart.tsx';
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

test('a chart stacks bars, breaks lines at gaps, and shows the values under the pointer', () => {
  const bars = render(
    <TimeChart
      title="Сообщения"
      kind="bar"
      labels={['15.10', '16.10']}
      series={[
        { name: 'В комнатах', values: [3, 0], color: 'red' },
        { name: 'В личке', values: [1, 2], color: 'blue' }
      ]}
    />
  );
  // Zero draws nothing: three bars for three non-zero values.
  expect(bars.container.querySelectorAll('rect')).toHaveLength(3);
  bars.unmount();

  render(
    <TimeChart
      title="Процессор"
      labels={['10:00', '10:05', '10:10', '10:15']}
      series={[{ name: 'Загрузка', values: [10, null, 30, 40], color: 'red' }]}
      format={(value) => `${value}%`}
      note="Весь сервер."
    />
  );
  const path = must(document.querySelector('path.chart-line'), 'the line').getAttribute('d') ?? '';
  expect(path.match(/M/g)).toHaveLength(2);
  expect(screen.getByText('Весь сервер.')).toBeTruthy();

  const svg = screen.getByRole('img', { name: 'Процессор' });
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, PLOT_WIDTH, 180));
  // The plot starts 44px in; the last point sits at its right edge.
  fireEvent.pointerMove(svg, { clientX: PLOT_WIDTH - 12 });
  const tip = screen.getByRole('status');
  expect(tip.textContent).toContain('10:15');
  expect(tip.textContent).toContain('40%');
  fireEvent.pointerMove(svg, { clientX: 44 + (PLOT_WIDTH - 56) / 3 });
  expect(screen.getByRole('status').textContent).toContain('—');
  fireEvent.pointerLeave(svg);
  expect(screen.queryByRole('status')).toBeNull();
});

test('a chart with nothing to draw says so', () => {
  render(<TimeChart title="Пусто" labels={[]} series={[]} />);
  expect(screen.getByText('Пока нет данных')).toBeTruthy();
});

test('counts get whole-number gridlines, fractions keep round ones', () => {
  const axis = (container: HTMLElement) =>
    [...container.querySelectorAll('text.chart-axis[text-anchor="end"]')].map((node) => node.textContent?.trim());
  const chart = (title: string, values: number[]) => (
    <TimeChart title={title} labels={['15.10', '16.10']} series={[{ name: 'Всего', values, color: 'red' }]} />
  );

  const counts = render(chart('Аккаунты', [0, 1]));
  expect(axis(counts.container)).toEqual(['0', '1', '2']);
  counts.unmount();
  const many = render(chart('Сообщения', [3, 37]));
  expect(axis(many.container)).toEqual(['0', '20', '40']);
  many.unmount();
  const hours = render(chart('Часы', [0.5, 1]));
  expect(axis(hours.container)).toEqual(['0', '0,5', '1']);
});

test('a sparkline draws a trend from two points and leaves a gap where a value is missing', () => {
  const drawn = render(<Sparkline values={[1, null, 3, 4]} label="Тренд" />);
  const line = must(drawn.container.querySelector('path.spark-line'), 'the line').getAttribute('d') ?? '';
  expect(line.match(/M/g)).toHaveLength(2);
  expect(drawn.container.querySelector('path.spark-area')?.getAttribute('d')).toMatch(/Z$/);
  drawn.unmount();
  const flat = render(<Sparkline values={[5]} label="Одна точка" />);
  expect(flat.container.querySelector('svg')).toBeNull();
});

test('a long chart names five dates, first to last, and the legend gives each latest value', () => {
  const labels = Array.from({ length: 14 }, (_, index) => `${String(index + 1).padStart(2, '0')}.10`);
  render(
    <TimeChart
      title="Активность"
      labels={labels}
      series={[
        { name: 'Активные', values: [...Array.from({ length: 13 }, () => 5), 12], color: 'red' },
        { name: 'Всего', values: [...Array.from({ length: 13 }, () => 20), null], color: 'blue', dashed: true }
      ]}
    />
  );
  const dates = [...document.querySelectorAll('text.chart-axis[text-anchor="middle"]')].map((node) => node.textContent);
  expect(dates).toEqual(['01.10', '04.10', '08.10', '11.10', '14.10']);

  // The latest measured value: a gap at the end falls back to the one before.
  const legend = must(document.querySelector('.chart-legend'), 'the legend');
  expect(legend.textContent).toContain('Активные12');
  expect(legend.textContent).toContain('Всего20');

  expect(document.querySelectorAll('path.chart-area')).toHaveLength(1);
  const lines = [...document.querySelectorAll('path.chart-line')];
  expect(lines.map((line) => line.getAttribute('data-dashed'))).toEqual(['false', 'true']);
});

test('bars draw no fill under them', () => {
  render(
    <TimeChart
      title="Запросы"
      kind="bar"
      labels={['1', '2']}
      series={[{ name: 'Все', values: [1, 2], color: 'red' }]}
    />
  );
  expect(document.querySelector('path.chart-area')).toBeNull();
});
