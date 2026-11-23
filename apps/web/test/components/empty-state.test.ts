import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { h } from 'vue';
import { Button, EmptyState } from '@voiceroom/ui-kit/components';

test('shows the empty state copy and offers its action outside compact panels', async () => {
  const onClick = vi.fn();
  const view = render(EmptyState, {
    props: { title: 'Пока нет друзей', text: 'Добавьте друга по логину.' },
    slots: { action: () => h(Button, { size: 'sm', onClick }, () => 'Добавить друга') }
  });
  expect(screen.getByText('Пока нет друзей')).toBeTruthy();
  expect(screen.getByText('Добавьте друга по логину.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Добавить друга' }));
  expect(onClick).toHaveBeenCalledOnce();

  await view.rerender({ compact: true });
  expect(screen.getByText('Пока нет друзей')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Добавить друга' })).toBeNull();
});
