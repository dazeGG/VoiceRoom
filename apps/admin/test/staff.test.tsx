// The staff section: the list says each member's role and what may be done
// with it (not with oneself, not with a superadmin from the settings); a role
// is given by login and taken away; the summary and the table of rights say
// what each role may do and open, as the roles really are.

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import type { StaffMember, StaffRole } from '@voice-room/shared/contracts/staff';
import { StaffPage } from '../src/pages/StaffPage.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';

afterEach(cleanup);

function member(id: string, login: string, role: StaffRole, fixed = false): StaffMember {
  return {
    user: { id, login, displayName: login, avatarUrl: null, avatarColorKey: 'blue', avatarAccent: null },
    role,
    fixed
  };
}

const team = [
  member('u-root', 'root', 'superadmin', true),
  member('u-staff', 'staff', 'superadmin'),
  member('u-anna', 'anna', 'admin'),
  member('u-bob', 'bob', 'moderator')
];

function stubTeam() {
  return stubApi({
    'GET /api/staff/members': { body: { ok: true, staff: team } },
    'PUT /api/staff/role': { body: { ok: true } }
  });
}

test('the list says who has which role, and a role is given by login and taken away', async () => {
  const calls = stubTeam();
  renderAs(<StaffPage />, 'superadmin');

  const list = await screen.findByRole('list', { name: 'Сотрудники' });
  const [root, self, anna, bob] = within(list).getAllByRole('listitem');
  if (!root || !self || !anna || !bob) throw new Error('four members expected');
  expect(within(root).getByText('задан в настройках')).toBeTruthy();
  // The signed-in staff member (u-staff in the harness) cannot take their own role away.
  expect(within(self).getByText('это вы')).toBeTruthy();
  expect(within(anna).getByText('Администратор')).toBeTruthy();
  expect(within(bob).getByText('Модератор')).toBeTruthy();

  await userEvent.click(within(bob).getByRole('button', { name: 'Снять роль с @bob' }));
  await waitFor(() => expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ login: 'bob', role: null }));

  await userEvent.type(screen.getByRole('textbox', { name: /Логин/ }), '@carol');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Роль' }), 'admin');
  await userEvent.click(screen.getByRole('button', { name: 'Выдать роль' }));
  await waitFor(() =>
    expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ login: 'carol', role: 'admin' })
  );
  expect(await screen.findByText('@carol: Администратор')).toBeTruthy();
});

test('the summary counts the rights of each role', async () => {
  stubTeam();
  renderAs(<StaffPage />, 'superadmin');
  const summary = await screen.findByRole('region', { name: 'Кто что может' });
  expect(within(summary).getByText('8 из 8 прав')).toBeTruthy();
  expect(within(summary).getByText('7 из 8 прав')).toBeTruthy();
  expect(within(summary).getByText('4 из 8 прав')).toBeTruthy();
});

test('the table of rights says what each role may do and open, and closes by Escape', async () => {
  stubTeam();
  renderAs(<StaffPage />, 'superadmin');
  await userEvent.click(await screen.findByRole('button', { name: 'Таблица прав' }));
  const dialog = screen.getByRole('dialog', { name: 'Кто что может' });
  const table = within(dialog).getByRole('table', { name: 'Права ролей' });

  // Columns from the most to the least: superadmin, admin, moderator; with how many hold each.
  const [head] = within(table).getAllByRole('row');
  expect(
    head &&
      within(head)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
  ).toEqual(['Право', 'Суперадминистратор2 человека', 'Администратор1 человек', 'Модератор1 человек']);

  const rowOf = (title: RegExp) => {
    const row = within(table).getByRole('rowheader', { name: title }).closest('[role="row"]');
    if (!(row instanceof HTMLElement)) throw new Error(`no row ${String(title)}`);
    return within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent || cell.firstElementChild?.getAttribute('aria-label'));
  };
  expect(rowOf(/^Смотреть статистику/)).toEqual(['может', 'может', 'не может']);
  expect(rowOf(/^Выдавать и снимать роли/)).toEqual(['может', 'не может', 'не может']);
  expect(rowOf(/^Разбирать жалобы/)).toEqual(['может', 'может', 'может']);
  expect(rowOf(/^Разделы в меню/)).toEqual([
    'Обзор, Продукт, Отзывы, Сервер, Аккаунты, Комнаты, Жалобы, Сотрудники',
    'Обзор, Продукт, Отзывы, Сервер, Аккаунты, Комнаты, Жалобы',
    'Аккаунты, Комнаты, Жалобы'
  ]);

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
