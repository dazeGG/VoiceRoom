import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { Progress } from '@voice-room/ui/components';

test('determinate progress exposes its value and name', () => {
  render(Progress, { props: { label: 'Загрузка изображения', value: 64 } });
  const bar = screen.getByRole('progressbar', { name: 'Загрузка изображения' });
  expect(bar.getAttribute('aria-valuenow')).toBe('64');
  expect(screen.getByText('64%')).toBeTruthy();
});

test('indeterminate progress has a name without a current value', () => {
  render(Progress, { props: { label: 'Подключение к экрану' } });
  expect(screen.getByRole('progressbar', { name: 'Подключение к экрану' }).hasAttribute('aria-valuenow')).toBe(false);
});
