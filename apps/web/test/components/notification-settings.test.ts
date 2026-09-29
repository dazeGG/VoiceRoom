// The notifications tab asks for the browser's permission only when its switch
// is pressed, stays quiet when that works, and reports why when it does not.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import NotificationSettings from '../../src/lib/features/home/components/settings/NotificationSettings.svelte';
import { pushNotifications } from '../../src/lib/features/home/model/push-notifications.svelte';
import { syncNotificationPermission } from '../../src/lib/shared/notifications/preferences.svelte';
import type { SettingsSupport } from '../../src/lib/features/home/model/settings-support';
import { stubFetch } from '../fixtures/fetch.ts';

const browserTab: SettingsSupport = {
  desktopApp: false,
  mac: false,
  globalHotkeys: false,
  autostart: false,
  overlay: false,
  diagnostics: false
};

function stubNotification(answer: NotificationPermission) {
  const requestPermission = vi.fn(async () => {
    FakeNotification.permission = answer;
    return answer;
  });
  class FakeNotification {
    static permission: NotificationPermission = 'default';
    static requestPermission = requestPermission;
  }
  vi.stubGlobal('Notification', FakeNotification);
  syncNotificationPermission();
  return requestPermission;
}

beforeEach(() => {
  localStorage.clear();
  pushNotifications.supported = false;
  pushNotifications.active = false;
  pushNotifications.busy = false;
  pushNotifications.loaded = false;
  pushNotifications.serverEnabled = false;
});
afterEach(cleanup);

function renderTab() {
  const onToast = vi.fn();
  render(NotificationSettings, { props: { support: browserTab, users: [], rooms: [], onToast } });
  return onToast;
}

test('permission is asked only when the switch is pressed, and a grant turns it on quietly', async () => {
  stubFetch({ 'GET /api/blocks': { body: { ok: true, users: [] } } });
  const requestPermission = stubNotification('granted');
  const onToast = renderTab();

  const toggle = screen.getByRole('switch', { name: 'Push этого браузера' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText(/Запрос выполняется только по вашему действию/)).toBeTruthy();
  expect(requestPermission).not.toHaveBeenCalled();

  await userEvent.click(toggle);
  expect(requestPermission).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(onToast).not.toHaveBeenCalled();
});

test('a refused permission says where to change it', async () => {
  stubFetch({ 'GET /api/blocks': { body: { ok: true, users: [] } } });
  stubNotification('denied');
  const onToast = renderTab();

  await userEvent.click(screen.getByRole('switch', { name: 'Push этого браузера' }));
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Разрешите уведомления в настройках браузера'));
});

test('push that the server does not offer is reported as an error', async () => {
  stubFetch({
    'GET /api/blocks': { body: { ok: true, users: [] } },
    'GET /api/push/config': { body: { ok: true, enabled: false, vapidPublicKey: '' } }
  });
  stubNotification('granted');
  pushNotifications.supported = true;
  const onToast = renderTab();

  await userEvent.click(screen.getByRole('switch', { name: 'Push этого браузера' }));
  await vi.waitFor(() =>
    expect(onToast).toHaveBeenCalledWith('Push-уведомления не настроены на сервере', { variant: 'error' })
  );
});
