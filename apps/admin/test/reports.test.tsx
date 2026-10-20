// The reports section: open reports with the message as it stands now, one
// decision closing every report of that message, and the panel's count of open
// reports following what is shown.

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import { ReportsPage } from '../src/pages/ReportsPage.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';

afterEach(cleanup);

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
  const calls = stubApi({
    'GET /api/admin/reports': {
      body: { ok: true, reports: [adminReport('r1', 'm1'), adminReport('r2', 'm1'), adminReport('r3', 'm2')] }
    },
    'POST /api/admin/reports/r1/resolve': { body: { ok: true, resolved: 2 } }
  });
  const onResolved = vi.fn();
  renderAs(<ReportsPage onResolved={onResolved} />, 'moderator');

  expect((await screen.findAllByText('текст m1')).length).toBe(2);
  expect(screen.getAllByText(/Комната «Кухня»/).length).toBe(3);
  expect(screen.getAllByText('Оскорбления или угрозы').length).toBe(3);
  await waitFor(() => expect(onResolved).toHaveBeenLastCalledWith(3));

  const [first] = screen.getAllByRole('button', { name: 'Удалить сообщение' });
  if (!first) throw new Error('no remove button');
  await userEvent.click(first);

  await waitFor(() => expect(screen.queryByText('текст m1')).toBeNull());
  expect(screen.getByText('текст m2')).toBeTruthy();
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'remove_message' });
  // The panel's count follows: one report is left open.
  expect(onResolved).toHaveBeenLastCalledWith(1);
});

test('a message that is already gone can be dismissed but not removed again', async () => {
  const calls = stubApi({
    'GET /api/admin/reports': { body: { ok: true, reports: [adminReport('r1', 'm1', { deleted: true })] } },
    'POST /api/admin/reports/r1/resolve': { body: { ok: true, resolved: 1 } }
  });
  renderAs(<ReportsPage onResolved={vi.fn()} />, 'moderator');

  expect(await screen.findByText(/уже удалено/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Удалить сообщение' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

  expect(await screen.findByText('Открытых жалоб нет.')).toBeTruthy();
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'dismiss' });
});

test('a refused decision leaves the report in place and says why', async () => {
  stubApi({
    'GET /api/admin/reports': { body: { ok: true, reports: [adminReport('r1', 'm1')] } },
    'POST /api/admin/reports/r1/resolve': { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
  });
  renderAs(<ReportsPage onResolved={vi.fn()} />, 'moderator');

  await userEvent.click(await screen.findByRole('button', { name: 'Удалить сообщение' }));

  expect((await screen.findByRole('alert')).textContent).toBeTruthy();
  expect(screen.getByText('текст m1')).toBeTruthy();
});

test('the review tells a role without it that the section is not for them', async () => {
  stubApi({
    'GET /api/admin/reports': {
      status: 403,
      body: { ok: false, error: 'Platform administrator access required', code: 'platform_admin_required' }
    }
  });
  renderAs(<ReportsPage onResolved={vi.fn()} />, 'moderator');
  expect(await screen.findByText('Этот раздел недоступен вашей роли.')).toBeTruthy();
});
