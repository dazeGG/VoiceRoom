import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { Spinner } from '@voice-room/ui/components';

test('a spinner exposes a status with the default localized loading label', () => {
  render(Spinner);
  expect(screen.getByRole('status', { name: 'Загрузка…' })).toBeTruthy();
});

test('a spinner exposes the supplied accessible label', () => {
  render(Spinner, { props: { label: 'Подключение к серверу' } });
  expect(screen.getByRole('status', { name: 'Подключение к серверу' })).toBeTruthy();
});
