// Creating a room: two tabs driven like tabs (arrows, Home, End), a permanent
// room needs a name, a temporary one does not.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import CreateRoomDialog from '../../src/lib/features/home/components/CreateRoomDialog.svelte';

afterEach(cleanup);

function renderDialog() {
  const onCreate = vi.fn();
  render(CreateRoomDialog, { props: { open: true, creating: false, onClose: vi.fn(), onCreate } });
  return onCreate;
}

const selected = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');

test('arrow keys, Home and End move the selected tab and focus with it', async () => {
  renderDialog();
  const permanent = screen.getByRole('tab', { name: 'Постоянная' });
  expect(selected()).toBe(permanent);
  permanent.focus();

  await userEvent.keyboard('{ArrowRight}');
  expect(selected()?.textContent).toBe('Временная');
  await vi.waitFor(() => expect(document.activeElement).toBe(selected()));
  expect(screen.getByRole('tabpanel').textContent).toMatch(/комната исчезнет/);

  await userEvent.keyboard('{Home}');
  expect(selected()).toBe(permanent);
  await userEvent.keyboard('{End}');
  expect(selected()?.textContent).toBe('Временная');
  expect(permanent.tabIndex).toBe(-1);
});

test('a permanent room needs a name; a temporary one is created without it', async () => {
  const onCreate = renderDialog();
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
