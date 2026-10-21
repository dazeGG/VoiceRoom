// Reporting a message to the service operator from the message menu. The
// review lives in the admin app (apps/admin).

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import MessageContextMenu from '../../src/lib/shared/chat/MessageContextMenu.svelte';
import ReportMessageDialog from '../../src/lib/shared/chat/ReportMessageDialog.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(cleanup);

const menuProps = { open: true, x: 10, y: 10, onClose: vi.fn(), onCopy: vi.fn() };

test('the message menu offers a report only when the caller allows it', async () => {
  const first = render(MessageContextMenu, { props: menuProps });
  expect(screen.queryByRole('menuitem', { name: /Пожаловаться/ })).toBeNull();
  first.unmount();

  const onReport = vi.fn();
  const onClose = vi.fn();
  render(MessageContextMenu, { props: { ...menuProps, onClose, onReport } });
  await userEvent.click(screen.getByRole('menuitem', { name: /Пожаловаться/ }));
  expect(onReport).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalled();
});

test('reporting sits with deleting in one red moderation group', () => {
  render(MessageContextMenu, { props: { ...menuProps, canDelete: true, onDelete: vi.fn(), onReport: vi.fn() } });
  const report = screen.getByRole('menuitem', { name: /Пожаловаться/ });
  const remove = screen.getByRole('menuitem', { name: /Удалить/ });
  expect(report.nextElementSibling).toBe(remove);
  expect(report.previousElementSibling?.getAttribute('role')).toBe('separator');
  for (const item of [report, remove]) expect(item.className).toContain('popover-menu-item--danger');
});

test('a report needs a reason and sends the target, the reason and the comment', async () => {
  const { calls } = stubFetch({ 'POST /api/reports': { status: 201, body: { ok: true, status: 'filed' } } });
  const onReported = vi.fn();
  const onClose = vi.fn();
  render(ReportMessageDialog, {
    props: { target: { kind: 'room_message', roomId: 'kitchen', messageId: 'm1' }, onClose, onReported }
  });

  const submit = screen.getByRole('button', { name: 'Отправить жалобу' });
  expect(submit).toHaveProperty('disabled', true);
  await userEvent.click(screen.getByText('Спам или реклама'));
  expect(screen.getByRole('radio', { name: 'Спам или реклама' })).toHaveProperty('checked', true);
  expect(screen.getByRole('radio', { name: 'Другое' })).toHaveProperty('checked', false);
  await userEvent.type(screen.getByLabelText(/Комментарий/), '  реклама казино  ');
  await userEvent.click(submit);

  await vi.waitFor(() => expect(onReported).toHaveBeenCalledWith('Жалоба отправлена, спасибо'));
  expect(onClose).toHaveBeenCalled();
  expect(calls[0]?.body).toEqual({
    target: { kind: 'room_message', roomId: 'kitchen', messageId: 'm1' },
    reason: 'spam',
    comment: 'реклама казино'
  });
});

test('a refused report keeps the dialog open with the reason', async () => {
  stubFetch({
    'POST /api/reports': {
      status: 404,
      body: { ok: false, error: 'Message not found', code: 'report_target_not_found' }
    }
  });
  const onClose = vi.fn();
  render(ReportMessageDialog, {
    props: { target: { kind: 'direct_message', messageId: 'dm1' }, onClose, onReported: vi.fn() }
  });
  await userEvent.click(screen.getByLabelText('Другое'));
  await userEvent.click(screen.getByRole('button', { name: 'Отправить жалобу' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Сообщение не найдено или уже удалено');
  expect(onClose).not.toHaveBeenCalled();
});
