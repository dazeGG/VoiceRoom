// The notifications panel closes the way a popover does: its button or Escape.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import NotificationInbox from '../../src/lib/features/home/components/NotificationInbox.svelte';
import { createNotificationInbox } from '../../src/lib/shared/notifications/inbox.svelte';

afterEach(cleanup);

function renderInbox() {
  const inbox = createNotificationInbox({ list: vi.fn(), read: vi.fn(), readAll: vi.fn() });
  const onclose = vi.fn();
  render(NotificationInbox, { props: { inbox, onopen: vi.fn(), onclose } });
  return onclose;
}

test('Escape closes the notifications panel, like its close button', async () => {
  const onclose = renderInbox();
  // The room keeps its own dialogs mounted and hidden; they do not count.
  const hiddenDialog = document.createElement('div');
  hiddenDialog.setAttribute('role', 'dialog');
  hiddenDialog.setAttribute('aria-modal', 'true');
  hiddenDialog.hidden = true;
  document.body.append(hiddenDialog);
  onTestFinished(() => hiddenDialog.remove());

  await userEvent.keyboard('{Escape}');
  expect(onclose).toHaveBeenCalledOnce();

  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onclose).toHaveBeenCalledTimes(2);
});

test('an Escape meant for something above the panel leaves it open', async () => {
  const onclose = renderInbox();
  const handled = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener('keydown', handled, { capture: true });
  await userEvent.keyboard('{Escape}');
  window.removeEventListener('keydown', handled, { capture: true });
  expect(onclose).not.toHaveBeenCalled();

  // Settings opened over the panel: Escape closes the dialog, not both.
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  await userEvent.keyboard('{Escape}');
  dialog.remove();
  expect(onclose).not.toHaveBeenCalled();
});
