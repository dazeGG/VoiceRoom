import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueLogin } from './helpers';

test('joining a room establishes voice through the public LiveKit gate', async ({ page }) => {
  const expectedLiveKitHost = process.env.PLAYWRIGHT_EXPECTED_LIVEKIT_HOST ?? 'voice-gate.test:7890';
  const observedSockets: Array<{ host: string; path: string; hasGateCredential: boolean }> = [];
  const diagnostics: string[] = [];
  const diagnosticUrl = (value: string) => {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return 'invalid-url';
    }
  };
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning' || message.text().includes('livekit_recovery_transition')) {
      diagnostics.push(`console:${message.type()}:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.method()}:${diagnosticUrl(request.url())}:${request.failure()?.errorText || 'unknown'}`);
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/livekit-token')) {
      diagnostics.push(`livekit-token:${response.status()}`);
    }
  });
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
  try {
    await expect(connection).toContainText('Голос подключен', { timeout: 30_000 });
  } catch (error) {
    const status = await page.locator('.status-pill').allTextContents();
    const toast = await page.locator('#toast').textContent().catch(() => '');
    throw new Error([
      error instanceof Error ? error.message : String(error),
      `status-pills:${JSON.stringify(status)}`,
      `toast:${toast || ''}`,
      ...diagnostics.slice(-30)
    ].join('\n'));
  }
  await expect(page.locator('#toast')).not.toContainText('LiveKit недоступен');
  await expect.poll(() => observedSockets.some((socket) => (
    socket.host === expectedLiveKitHost
      && socket.path.startsWith('/rtc')
      && socket.hasGateCredential
  ))).toBe(true);
});
