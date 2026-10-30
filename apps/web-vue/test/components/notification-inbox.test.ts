// The notifications panel closes the way a popover does: its button or Escape.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test, vi } from 'vitest';
import NotificationInbox from '@/features/home/components/NotificationInbox.vue';
import { createNotificationInbox } from '@/shared/notifications/inbox';
import { renderWithApp } from '../helpers/render';

async function renderInbox() {
  const inbox = createNotificationInbox({ list: vi.fn(), read: vi.fn(), readAll: vi.fn() });
  const onClose = vi.fn();
  await renderWithApp(NotificationInbox, { props: { inbox, onOpen: vi.fn(), onClose } });
  return onClose;
}

test('Escape closes the notifications panel, like its close button', async () => {
  const onClose = await renderInbox();
  // The room keeps its own dialogs mounted and hidden; they do not count.
  const hiddenDialog = document.createElement('div');
  hiddenDialog.setAttribute('role', 'dialog');
  hiddenDialog.setAttribute('aria-modal', 'true');
  hiddenDialog.hidden = true;
  document.body.append(hiddenDialog);
  onTestFinished(() => hiddenDialog.remove());

  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();

  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('an Escape meant for something above the panel leaves it open', async () => {
  const onClose = await renderInbox();
  const handled = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener('keydown', handled, { capture: true });
  await userEvent.keyboard('{Escape}');
  window.removeEventListener('keydown', handled, { capture: true });
  expect(onClose).not.toHaveBeenCalled();

  // Settings opened over the panel: Escape closes the dialog, not both.
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  await userEvent.keyboard('{Escape}');
  dialog.remove();
  expect(onClose).not.toHaveBeenCalled();
});
