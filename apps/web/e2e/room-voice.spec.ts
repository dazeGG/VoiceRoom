import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueLogin } from './helpers';

test('joining a room establishes voice through the public LiveKit gate', async ({ page }) => {
  const observedSockets: Array<{ host: string; path: string; hasGateCredential: boolean }> = [];
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    if (!url.pathname.startsWith('/rtc')) return;
    observedSockets.push({
      host: url.host,
      path: url.pathname,
      hasGateCredential: url.searchParams.has('vr_gate_credential')
    });
  });

  const login = uniqueLogin('voicejoin');
  await registerViaUi(page, login);
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая комната' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Название комнаты').fill(`Voice join ${login}`);
  const [createdResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST'
    ),
    dialog.getByRole('button', { name: 'Создать комнату' }).click()
  ]);
  expect(createdResponse.ok()).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'room', { timeout: 20_000 });

  const connection = page.locator('.status-pill[data-state="connected"]');
  await expect(connection).toContainText('Голос подключен', { timeout: 30_000 });
  await expect(page.locator('#toast')).not.toContainText('LiveKit недоступен');
  await expect.poll(() => observedSockets.some((socket) => (
    socket.host === 'voice-gate.test:7890'
      && socket.path.startsWith('/rtc')
      && socket.hasGateCredential
  ))).toBe(true);
});
