import { render, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import UserReports from '../src/pages/UserReports.vue';
import { stubApi } from './helpers/api.ts';

test('user reports group by account and are reviewed without any delete-message action', async () => {
  const userReport = (id: string) => ({
    id,
    reason: 'abuse',
    comment: 'навязчивые звонки',
    createdAt: Date.UTC(2026, 9, 25),
    reporter: { userId: 'alice', login: 'alice', displayName: 'Алиса' },
    target: { userId: 'bob', login: 'bob', displayName: 'Боб', deleted: false }
  });
  const calls = stubApi({
    'GET /api/admin/user-reports': { body: { ok: true, reports: [userReport('r-user-1'), userReport('r-user-2')] } },
    'POST /api/admin/user-reports/r-user-1/resolve': { body: { ok: true, resolved: 2 } }
  });
  const onResolved = vi.fn();
  const onOpenAccount = vi.fn();
  render(UserReports, { props: { onResolved, onOpenAccount } });
  const open = await screen.findByRole('button', { name: 'Открыть аккаунт' });
  const groups = screen.getByRole('list', { name: 'Жалобы на пользователей' });
  expect(within(groups).getAllByRole('heading', { level: 3 })).toHaveLength(1);
  await userEvent.click(open);
  expect(onOpenAccount).toHaveBeenCalledWith('bob');
  expect(screen.queryByRole('button', { name: 'Удалить сообщение' })).toBeNull();
  await waitFor(() => expect(onResolved).toHaveBeenLastCalledWith(2));
  await userEvent.click(screen.getByRole('button', { name: 'Рассмотрено' }));
  expect(await screen.findByText('Жалоб на пользователей нет')).toBeTruthy();
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'reviewed' });
  await waitFor(() => expect(onResolved).toHaveBeenLastCalledWith(0));
});

test('a failed user decision preserves the report and explains the failure', async () => {
  stubApi({
    'GET /api/admin/user-reports': {
      body: {
        ok: true,
        reports: [
          {
            id: 'user-report',
            reason: 'spam',
            comment: 'спам',
            createdAt: 1,
            reporter: { userId: 'alice', login: 'alice', displayName: 'Алиса' },
            target: { userId: 'bob', login: '', displayName: '', deleted: true }
          }
        ]
      }
    },
    'POST /api/admin/user-reports/user-report/resolve': {
      status: 500,
      body: { ok: false, error: 'retry later', code: 'internal_error' }
    }
  });
  render(UserReports);
  await userEvent.click(await screen.findByRole('button', { name: 'Отклонить жалобы' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Не удалось закрыть жалобу');
  expect(screen.getByText('Аккаунт уже удалён')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Открыть аккаунт' })).toBeNull();
});
