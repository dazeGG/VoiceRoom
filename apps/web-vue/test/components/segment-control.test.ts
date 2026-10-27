import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import SegmentControl from '@/shared/ui/SegmentControl/SegmentControl.vue';

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

test('clicking the selected option reports it again', async () => {
  const onChange = vi.fn();
  render(SegmentControl, { props: { options, value: 'chat', onChange, ariaLabel: 'Режим' } });
  await userEvent.click(screen.getByRole('radio', { name: 'Чат' }));
  expect(onChange).toHaveBeenCalledWith('chat');
});

test('arrow keys move to the next enabled option', async () => {
  const onChange = vi.fn();
  render(SegmentControl, { props: { options, value: 'people', onChange, ariaLabel: 'Режим' } });
  screen.getByRole('radio', { name: 'Участники' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenLastCalledWith('chat');
});
