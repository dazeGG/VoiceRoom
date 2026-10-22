// The reports section: open reports by message (two reports of one message
// are one card, ×2), the chosen one shown with the message as it stands now,
// one decision closing every report of that message, the panel's count of open
// reports following what is shown, and the list asked again every minute.

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import { ReportsPage } from '../src/pages/ReportsPage.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function adminReport(
  id: string,
  messageId: string,
  overrides: Partial<AdminReport['target']> = {},
  createdAt = Date.UTC(2026, 9, 13, 10)
): AdminReport {
  return {
    id,
    reason: 'abuse',
    comment: 'грубит',
    createdAt,
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

const cards = () => within(screen.getByRole('list', { name: 'Открытые жалобы' })).getAllByRole('button');
const detail = () => screen.getByRole('region', { name: 'Оскорбления или угрозы' });

test('two reports of one message are one card, and removing it drops both', async () => {
  const calls = stubApi({
    'GET /api/admin/reports': {
      body: {
        ok: true,
        reports: [
          adminReport('r1', 'm1', {}, Date.UTC(2026, 9, 13, 12)),
          adminReport('r2', 'm1'),
          adminReport('r3', 'm2', {}, Date.UTC(2026, 9, 13, 11))
        ]
      }
    },
    'POST /api/admin/reports/r1/resolve': { body: { ok: true, resolved: 2 } }
  });
  const onResolved = vi.fn();
  renderAs(<ReportsPage onResolved={onResolved} onOpenAccount={vi.fn()} />, 'moderator');

  await screen.findByRole('list', { name: 'Открытые жалобы' });
  // The newest report first; m1 was reported twice.
  const [m1, m2, ...rest] = cards();
  if (!m1 || !m2 || rest.length) throw new Error('two cards expected');
  expect(within(m1).getByText('текст m1')).toBeTruthy();
  expect(within(m1).getByLabelText('2 жалобы')).toBeTruthy();
  expect(within(m2).getByText('текст m2')).toBeTruthy();
  await waitFor(() => expect(onResolved).toHaveBeenLastCalledWith(3));

  // The first is shown at once, with its place and its comment.
  expect(within(detail()).getByText('2 жалобы на это сообщение')).toBeTruthy();
  expect(within(detail()).getByText(/Комната «Кухня»/)).toBeTruthy();
  expect(within(detail()).getAllByText('грубит')).toHaveLength(2);

  await userEvent.click(within(detail()).getByRole('button', { name: 'Удалить сообщение' }));
  await waitFor(() => expect(screen.queryByText('текст m1')).toBeNull());
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'remove_message' });
  // The next message is shown; the panel's count follows: one report is left open.
  expect(within(detail()).getByText('текст m2')).toBeTruthy();
  expect(onResolved).toHaveBeenLastCalledWith(1);
});

test('a card picks the report shown, and the author opens their card', async () => {
  stubApi({
    'GET /api/admin/reports': {
      body: { ok: true, reports: [adminReport('r1', 'm1'), adminReport('r2', 'm2', { authorUserId: 'u-carol' })] }
    }
  });
  const onOpenAccount = vi.fn();
  renderAs(<ReportsPage onResolved={vi.fn()} onOpenAccount={onOpenAccount} />, 'moderator');
  await screen.findByRole('list', { name: 'Открытые жалобы' });

  const second = cards().find((card) => within(card).queryByText('текст m2'));
  if (!second) throw new Error('no card of m2');
  await userEvent.click(second);
  expect(second.getAttribute('aria-pressed')).toBe('true');
  expect(within(detail()).getByText('текст m2')).toBeTruthy();
  await userEvent.click(within(detail()).getByRole('button', { name: 'Аккаунт автора' }));
  expect(onOpenAccount).toHaveBeenCalledWith('u-carol');
});

test('a message that is already gone can be dismissed but not removed again', async () => {
  const calls = stubApi({
    'GET /api/admin/reports': { body: { ok: true, reports: [adminReport('r1', 'm1', { deleted: true })] } },
    'POST /api/admin/reports/r1/resolve': { body: { ok: true, resolved: 1 } }
  });
  renderAs(<ReportsPage onResolved={vi.fn()} onOpenAccount={vi.fn()} />, 'moderator');

  expect(await screen.findByText(/уже удалено/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Удалить сообщение' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

  expect(await screen.findByText('Открытых жалоб нет')).toBeTruthy();
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'dismiss' });
});

test('a refused decision leaves the report in place and says why', async () => {
  stubApi({
    'GET /api/admin/reports': { body: { ok: true, reports: [adminReport('r1', 'm1')] } },
    'POST /api/admin/reports/r1/resolve': { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
  });
  renderAs(<ReportsPage onResolved={vi.fn()} onOpenAccount={vi.fn()} />, 'moderator');

  await userEvent.click(await screen.findByRole('button', { name: 'Удалить сообщение' }));

  expect((await screen.findByRole('alert')).textContent).toBeTruthy();
  expect(within(detail()).getByText('текст m1')).toBeTruthy();
});

test('the list asks again every minute', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let reports = [adminReport('r1', 'm1')];
  stubApi({ 'GET /api/admin/reports': () => ({ body: { ok: true, reports } }) });
  renderAs(<ReportsPage onResolved={vi.fn()} onOpenAccount={vi.fn()} />, 'moderator');
  await screen.findByRole('list', { name: 'Открытые жалобы' });

  reports = [adminReport('r1', 'm1'), adminReport('r9', 'm9', {}, Date.UTC(2026, 9, 14))];
  await vi.advanceTimersByTimeAsync(60_000);
  await waitFor(() => expect(cards()).toHaveLength(2));
});

test('the review tells a role without it that the section is not for them', async () => {
  stubApi({
    'GET /api/admin/reports': {
      status: 403,
      body: { ok: false, error: 'Platform administrator access required', code: 'platform_admin_required' }
    }
  });
  renderAs(<ReportsPage onResolved={vi.fn()} onOpenAccount={vi.fn()} />, 'moderator');
  expect(await screen.findByText('Этот раздел недоступен вашей роли.')).toBeTruthy();
});
