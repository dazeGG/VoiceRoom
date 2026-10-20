// The admin app opens the sections a role may see, starts on the first of
// them when the address names another, and counts the open reports on the
// reports tab for those who review them.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import type { StaffRole } from '@voice-room/shared/contracts/staff';
import { App } from '../src/App.tsx';
import { staffOf, stubApi } from './helpers/harness.tsx';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function report(id: string): AdminReport {
  return {
    id,
    reason: 'spam',
    comment: '',
    createdAt: 1,
    reporter: { userId: 'u-1', login: 'one', displayName: 'Один' },
    target: {
      kind: 'direct_message',
      messageId: `m-${id}`,
      roomId: null,
      roomName: null,
      authorUserId: 'u-2',
      authorName: 'Два',
      text: 'текст',
      sentAt: 1,
      deleted: false
    }
  };
}

function signedInAs(role: StaffRole, openReports = 0) {
  return stubApi({
    'GET /api/staff/me': { body: { ok: true, ...staffOf(role) } },
    'GET /api/admin/reports': {
      body: { ok: true, reports: Array.from({ length: openReports }, (_, index) => report(`r-${String(index)}`)) }
    }
  });
}

async function tabs(): Promise<HTMLElement[]> {
  return within(await screen.findByRole('tablist', { name: 'Разделы' })).getAllByRole('tab');
}

test('a moderator sees accounts, rooms and reports, and no numbers or staff', async () => {
  signedInAs('moderator');
  render(<App />);
  expect((await tabs()).map((tab) => tab.textContent)).toEqual(['Аккаунты', 'Комнаты', 'Жалобы']);
  // "/" is the overview, which a moderator may not open: the first allowed section opens instead.
  expect(window.location.pathname).toBe('/accounts');
  expect(screen.getByText(/Модератор/)).toBeTruthy();
});

test('a superadmin sees every section, the staff one included', async () => {
  signedInAs('superadmin');
  render(<App />);
  expect((await tabs()).map((tab) => tab.textContent)).toEqual([
    'Обзор',
    'Продукт',
    'Сервер',
    'Аккаунты',
    'Комнаты',
    'Жалобы',
    'Отзывы',
    'Сотрудники'
  ]);
});

test('the address keeps the section across a reload', async () => {
  window.history.replaceState(null, '', '/staff');
  signedInAs('superadmin');
  render(<App />);
  const staffTab = (await tabs()).find((tab) => tab.textContent === 'Сотрудники');
  expect(staffTab?.getAttribute('aria-selected')).toBe('true');
  expect(window.location.pathname).toBe('/staff');
});

test('the reports tab counts the open reports', async () => {
  signedInAs('moderator', 3);
  render(<App />);
  expect(await screen.findByLabelText('открытых: 3')).toBeTruthy();
});

test('the reports tab keeps the fresh poll count while the reports page stays open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.replaceState(null, '', '/reports');
  let asked = 0;
  stubApi({
    'GET /api/staff/me': { body: { ok: true, ...staffOf('moderator') } },
    // The poll and the page ask once each on opening; the poll a minute later hears of two more.
    'GET /api/admin/reports': () => {
      asked += 1;
      const count = asked <= 2 ? 1 : 3;
      return {
        body: { ok: true, reports: Array.from({ length: count }, (_, index) => report(`r-${String(index)}`)) }
      };
    }
  });
  render(<App />);
  expect(await screen.findByLabelText('открытых: 1')).toBeTruthy();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(await screen.findByLabelText('открытых: 3')).toBeTruthy();
  // The page has no new list, so it does not speak again over the fresh count.
  await vi.advanceTimersByTimeAsync(100);
  expect(screen.getByLabelText('открытых: 3')).toBeTruthy();
});
