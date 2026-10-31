// Creating a room: two tabs driven like tabs (arrows, Home, End), a permanent
// room needs a name, a temporary one does not.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import CreateRoomDialog from '@/features/home/components/CreateRoomDialog.vue';
import { renderWithApp } from '../helpers/render';

async function renderDialog() {
  const onCreate = vi.fn();
  await renderWithApp(CreateRoomDialog, { props: { open: true, creating: false, onClose: vi.fn(), onCreate } });
  return onCreate;
}

const selected = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');

test('arrow keys, Home and End move the selected tab and focus with it', async () => {
  await renderDialog();
  const permanent = screen.getByRole('tab', { name: 'Постоянная' });
  expect(selected()).toBe(permanent);
  permanent.focus();

  await userEvent.keyboard('{ArrowRight}');
  expect(selected()?.textContent?.trim()).toBe('Временная');
  await vi.waitFor(() => expect(document.activeElement).toBe(selected()));
  expect(screen.getByRole('tabpanel').textContent).toMatch(/комната исчезнет/);

  await userEvent.keyboard('{Home}');
  expect(selected()).toBe(permanent);
  await userEvent.keyboard('{End}');
  expect(selected()?.textContent?.trim()).toBe('Временная');
  expect(permanent.tabIndex).toBe(-1);
});

test('a permanent room needs a name; a temporary one is created without it', async () => {
  const onCreate = await renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
  expect(screen.getByRole('alert').textContent).toBe('Дайте комнате название');
  expect(onCreate).not.toHaveBeenCalled();

  await userEvent.type(screen.getByLabelText('Название'), '  Кухня ');
  await userEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
  expect(onCreate).toHaveBeenLastCalledWith({ name: 'Кухня', isStatic: true });

  await userEvent.click(screen.getByRole('tab', { name: 'Временная' }));
  await userEvent.clear(screen.getByLabelText(/Название/));
  await userEvent.click(screen.getByRole('button', { name: 'Создать на время' }));
  expect(onCreate).toHaveBeenLastCalledWith({ name: '', isStatic: false });
});
