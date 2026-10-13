// Reporting a message to the service operator from the message menu, and the
// platform administrator's review page.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import MessageContextMenu from '../../src/lib/shared/chat/MessageContextMenu.svelte';
import ReportMessageDialog from '../../src/lib/shared/chat/ReportMessageDialog.svelte';
import ReportsReview from '../../src/lib/features/admin/ReportsReview.svelte';
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

test('a report needs a reason and sends the target, the reason and the comment', async () => {
  const { calls } = stubFetch({ 'POST /api/reports': { status: 201, body: { ok: true, status: 'filed' } } });
  const onReported = vi.fn();
  const onClose = vi.fn();
  render(ReportMessageDialog, {
    props: { target: { kind: 'room_message', roomId: 'kitchen', messageId: 'm1' }, onClose, onReported }
  });

  const submit = screen.getByRole('button', { name: 'Отправить жалобу' });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByLabelText('Спам или реклама'));
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

function adminReport(id: string, messageId: string, overrides: Partial<AdminReport['target']> = {}): AdminReport {
  return {
    id,
    reason: 'abuse',
    comment: 'грубит',
    createdAt: Date.UTC(2026, 9, 13, 10),
    reporter: { userId: 'u-alice', login: 'alice', displayName: 'Алиса' },
    target: {
      kind: 'room_message',
      messageId,
      roomId: 'kitchen',
      roomName: 'Кухня',
      authorUserId: 'u-bob',
      authorName: 'Боб',
      text: `текст ${messageId}`,
      sentAt: Date.UTC(2026, 9, 13, 9),
      deleted: false,
      ...overrides
    }
  };
}

test('the review removes a reported message and drops every report of it', async () => {
  const { calls } = stubFetch({
    'GET /api/admin/reports': {
      body: { ok: true, reports: [adminReport('r1', 'm1'), adminReport('r2', 'm1'), adminReport('r3', 'm2')] }
    },
    'POST /api/admin/reports/r1/resolve': { body: { ok: true, resolved: 2 } }
  });
  render(ReportsReview);

  expect((await screen.findAllByText('текст m1')).length).toBe(2);
  expect(screen.getAllByText(/Комната «Кухня»/).length).toBe(3);
  await userEvent.click(screen.getAllByRole('button', { name: 'Удалить сообщение' })[0]);

  await vi.waitFor(() => expect(screen.queryByText('текст m1')).toBeNull());
  expect(screen.getByText('текст m2')).toBeTruthy();
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'remove_message' });
});

test('the review tells a non-administrator the page is not for them', async () => {
  stubFetch({
    'GET /api/admin/reports': {
      status: 403,
      body: { ok: false, error: 'Platform administrator access required', code: 'platform_admin_required' }
    }
  });
  render(ReportsReview);
  expect(await screen.findByText('Этот раздел доступен только администратору сервиса.')).toBeTruthy();
});
