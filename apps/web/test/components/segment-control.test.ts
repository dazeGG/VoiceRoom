import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import SegmentControl from '../../src/lib/shared/ui/SegmentControl/SegmentControl.svelte';

afterEach(cleanup);

const options = [
  { value: 'chat', label: 'Чат' },
  { value: 'people', label: 'Участники' },
  { value: 'off', label: 'Выкл', disabled: true }
];

test('marks the current option and reports a click', async () => {
  const onChange = vi.fn();
  render(SegmentControl, { props: { options, value: 'chat', onChange, ariaLabel: 'Раздел', kind: 'tabs' } });
  expect(screen.getByRole('tab', { name: 'Чат' }).getAttribute('aria-selected')).toBe('true');
  await userEvent.click(screen.getByRole('tab', { name: 'Участники' }));
  expect(onChange).toHaveBeenCalledWith('people');
});

test('arrow keys move to the next enabled option', async () => {
  const onChange = vi.fn();
  render(SegmentControl, { props: { options, value: 'people', onChange, ariaLabel: 'Режим' } });
  screen.getByRole('radio', { name: 'Участники' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenLastCalledWith('chat');
});
