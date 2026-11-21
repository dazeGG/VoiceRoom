import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { TimeRangePicker } from '../src/TimeRangePicker.tsx';
import { PRODUCT_PRESETS, type TimeRange } from '../src/time-range.ts';

afterEach(cleanup);

test('custom dates preserve zero checked presets through focus until explicit selection', async () => {
  const changed = vi.fn<(next: TimeRange) => void>();
  function Range() {
    const [value, setValue] = useState<TimeRange>({ kind: 'preset', id: '7d' });
    return (
      <TimeRangePicker
        value={value}
        presets={PRODUCT_PRESETS}
        withTime={false}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Range />);
  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  await userEvent.click(screen.getByRole('button', { name: 'Показать' }));
  expect(changed.mock.lastCall?.[0].kind).toBe('custom');
  const group = within(screen.getByRole('radiogroup', { name: 'Период' }));
  expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  changed.mockClear();
  group.getByRole('radio', { name: '7 дней' }).focus();
  await userEvent.tab();
  expect(changed).not.toHaveBeenCalled();
  expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  await userEvent.click(group.getByRole('radio', { name: '14 дней' }));
  expect(changed).toHaveBeenLastCalledWith({ kind: 'preset', id: '14d' });
});

test('invalid custom range stays editable and focused until corrected', async () => {
  const changed = vi.fn<(range: TimeRange) => void>();
  render(
    <TimeRangePicker
      value={{ kind: 'preset', id: '7d' }}
      presets={PRODUCT_PRESETS}
      withTime={false}
      onChange={changed}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  const from = screen.getByLabelText('С');
  const to = screen.getByLabelText('По');
  fireEvent.change(from, { target: { value: '2026-11-16' } });
  fireEvent.change(to, { target: { value: '2026-11-15' } });
  const apply = screen.getByRole('button', { name: 'Показать' });
  await userEvent.click(apply);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Начало должно быть раньше конца');
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(apply);
  fireEvent.change(to, { target: { value: '2026-11-17' } });
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(apply);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Свой период' }));
});
