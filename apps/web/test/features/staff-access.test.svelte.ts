// Staff get the admin app's address and the open report count from the
// server; each new report arrives as a notice that stays and opens the reports
// in the admin app. An account that is not staff, or no answer, shows nothing.

import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { StaffAccess } from '../../src/lib/features/home/model/staff-access.svelte.ts';
import { getAppRealtime } from '../../src/lib/api/realtime.ts';
import type { ToastOptions } from '../../src/lib/features/home/model/toasts.svelte.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { defined } from '../helpers/assert.ts';

// The app keeps one realtime connection for its whole life, so the tests share it.
let socket: FakeWebSocket;

beforeAll(() => {
  installFakeWebSocket();
  getAppRealtime().subscribe(() => {});
  socket = FakeWebSocket.latest();
  socket.open();
});

let stop = (): void => {};
afterEach(() => {
  stop();
  stop = () => {};
});

const asStaff = (openReports: number) => ({
  'GET /api/staff/access': { body: { ok: true, staff: true, adminUrl: 'https://admin.example.test/', openReports } }
});

function start() {
  const onToast = vi.fn<(message: string, options?: ToastOptions) => void>();
  const staff = new StaffAccess(onToast);
  stop = staff.start();
  return { staff, onToast };
}

test('staff get the admin app and the open report count', async () => {
  stubFetch(asStaff(2));
  const { staff } = start();

  await vi.waitFor(() => expect(staff.adminUrl).toBe('https://admin.example.test/'));
  expect(staff.openReports).toBe(2);
});

test('no answer from the server leaves the link hidden', async () => {
  const { fetchMock } = stubFetch({ 'GET /api/staff/access': { status: 500, body: { ok: false } } });
  const { staff } = start();

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(staff.adminUrl).toBeNull();
  expect(staff.openReports).toBe(0);
});

test('a new report is a notice that stays and opens the reports; a resolved one only moves the count', async () => {
  stubFetch(asStaff(0));
  const { staff, onToast } = start();
  await vi.waitFor(() => expect(staff.adminUrl).not.toBeNull());

  socket.receive({
    type: 'admin.reports',
    payload: { openReports: 1, filed: { reason: 'spam', targetKind: 'room_message', roomName: 'Кухня' } }
  });
  expect(staff.openReports).toBe(1);
  expect(onToast).toHaveBeenCalledTimes(1);
  const [message, options] = defined(onToast.mock.calls[0], 'the notice');
  expect(message).toBe('Новая жалоба');
  expect(options).toMatchObject({ duration: 0, variant: 'warning', description: 'Спам или реклама · комната «Кухня»' });

  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  defined(defined(options?.actions, 'notice actions')[0], 'the notice action').onClick('toast-1');
  expect(opened).toHaveBeenCalledWith('https://admin.example.test/reports', '_blank', 'noopener');
  opened.mockRestore();

  onToast.mockClear();
  socket.receive({ type: 'admin.reports', payload: { openReports: 0, filed: null } });
  expect(staff.openReports).toBe(0);
  expect(onToast).not.toHaveBeenCalled();
});

test('once stopped, report events no longer reach it', async () => {
  stubFetch(asStaff(3));
  const { staff } = start();
  await vi.waitFor(() => expect(staff.openReports).toBe(3));

  stop();
  socket.receive({ type: 'admin.reports', payload: { openReports: 9, filed: null } });
  expect(staff.openReports).toBe(3);
});
