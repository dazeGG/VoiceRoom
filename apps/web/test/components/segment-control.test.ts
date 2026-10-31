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

test('the group is a tablist or a radiogroup and items carry no aria-pressed', () => {
  const view = render(SegmentControl, { props: { options, value: 'chat', ariaLabel: 'Раздел', kind: 'tabs' } });
  expect(screen.getByRole('tablist', { name: 'Раздел' })).toBeTruthy();
  for (const tab of screen.getAllByRole('tab')) expect(tab.hasAttribute('aria-pressed')).toBe(false);
  view.unmount();
  render(SegmentControl, { props: { options, value: 'chat', ariaLabel: 'Режим' } });
  expect(screen.getByRole('radiogroup', { name: 'Режим' })).toBeTruthy();
  for (const radio of screen.getAllByRole('radio')) expect(radio.hasAttribute('aria-pressed')).toBe(false);
});
