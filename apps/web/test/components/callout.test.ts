import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Callout } from '@voice-room/ui/components';

test('offers a localized close button and emits dismiss when activated', async () => {
  const view = render(Callout, { props: { title: 'Доступно обновление', dismissible: true } });
  expect(screen.getByText('Доступно обновление')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(view.emitted('dismiss')).toEqual([[]]);
});
