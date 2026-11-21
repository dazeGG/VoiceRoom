import { h, ref } from 'vue';
import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import TimeRangePicker from '../src/TimeRangePicker.vue';
import { renderFixture } from './helpers/render.ts';
import { PRODUCT_PRESETS, type TimeRange } from '../src/time-range.ts';

test('custom dates preserve zero checked presets through focus until explicit selection', async () => {
  const changed = vi.fn<(next: TimeRange) => void>();
  renderFixture(() => {
    const value = ref<TimeRange>({ kind: 'preset', id: '7d' });
    return () =>
      h(TimeRangePicker, {
        value: value.value,
        presets: PRODUCT_PRESETS,
        withTime: false,
        onChange(next: TimeRange) {
          changed(next);
          value.value = next;
        }
      });
  });
  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  await userEvent.click(screen.getByRole('button', { name: 'Показать' }));
  expect(changed.mock.lastCall?.[0].kind).toBe('custom');
  const group = within(screen.getByRole('radiogroup', { name: 'Период' }));
  expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  changed.mockClear();
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(group.getByRole('radio', { name: '7 дней' }));
  await userEvent.tab();
  expect(changed).not.toHaveBeenCalled();
  expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  await userEvent.click(group.getByRole('radio', { name: '14 дней' }));
  expect(changed).toHaveBeenLastCalledWith({ kind: 'preset', id: '14d' });
});

test('invalid custom range stays editable and focused until corrected', async () => {
  const changed = vi.fn<(range: TimeRange) => void>();
  render(TimeRangePicker, {
    props: { value: { kind: 'preset', id: '7d' }, presets: PRODUCT_PRESETS, withTime: false, onChange: changed }
  });
  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  const from = screen.getByLabelText('С');
  const to = screen.getByLabelText('По');
  await userEvent.clear(from);
  await userEvent.type(from, '2026-11-16');
  await userEvent.clear(to);
  await userEvent.type(to, '2026-11-15');
  const apply = screen.getByRole('button', { name: 'Показать' });
  await userEvent.click(apply);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Начало должно быть раньше конца');
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(apply);
  await userEvent.clear(to);
  await userEvent.type(to, '2026-11-17');
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(apply);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Свой период' }));
});
