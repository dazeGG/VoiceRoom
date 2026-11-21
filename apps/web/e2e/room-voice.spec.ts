import { expect, test } from '@playwright/test';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

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
    if (
      message.type() === 'error' ||
      message.type() === 'warning' ||
      message.text().includes('livekit_recovery_transition')
    ) {
      diagnostics.push(`console:${message.type()}:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(
      `requestfailed:${request.method()}:${diagnosticUrl(request.url())}:${request.failure()?.errorText || 'unknown'}`
    );
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
    page.waitForResponse((response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST'),
    dialog.getByRole('button', { name: 'Создать комнату' }).click()
  ]);
  expect(createdResponse.ok()).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveClass(/\bscreen--room\b/, { timeout: 20_000 });

  const connection = page.locator('.room-topbar__status--connected');
  try {
    await expect(connection).toContainText('Голос подключен', { timeout: 30_000 });
  } catch (error) {
    const status = await page.locator('.room-topbar__status').allTextContents();
    const toast = await page
      .locator('#toast')
      .textContent()
      .catch(() => '');
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `status-pills:${JSON.stringify(status)}`,
        `toast:${toast || ''}`,
        ...diagnostics.slice(-30)
      ].join('\n'),
      { cause: error }
    );
  }
  // The toast stack only exists while a toast is up, so check for the text itself.
  await expect(page.locator('#toast', { hasText: 'LiveKit недоступен' })).toHaveCount(0);
  await expect
    .poll(() =>
      observedSockets.some(
        (socket) => socket.host === expectedLiveKitHost && socket.path.startsWith('/rtc') && socket.hasGateCredential
      )
    )
    .toBe(true);
});

test('a shared screen plays on a second peer and closes when the publisher stops', async ({ browser }) => {
  const publisherContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    await publisherContext.addInitScript(() => {
      // Chromium supplies a synthetic video track and the normal call pipeline publishes it as screen video.
      const media = navigator.mediaDevices;
      media.getDisplayMedia = () => media.getUserMedia({ video: true, audio: false });
    });
    const publisher = await publisherContext.newPage();
    const viewer = await viewerContext.newPage();
    const publisherName = uniqueLogin('screenowner');
    await registerViaUi(publisher, publisherName);
    const roomId = await createPermanentRoom(publisher, 'Screen share smoke');
    await enterRoom(publisher, roomId);
    await registerViaUi(viewer, uniqueLogin('screenviewer'));
    await enterRoom(viewer, roomId);
    for (const page of [publisher, viewer]) {
      await expect(page.locator('.room-topbar__status--connected')).toContainText('Голос подключен');
    }

    const share = publisher.locator('#screenButton');
    await share.click();
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await viewer.getByRole('button', { name: `Смотреть стрим ${publisherName}` }).click();
    await expect(viewer.locator('body')).toHaveClass(/\bscreen-view--open\b/);
    await expect
      .poll(() =>
        viewer.locator('#screenVideo').evaluate((video) => (video instanceof HTMLVideoElement ? video.videoWidth : 0))
      )
      .toBeGreaterThan(0);

    await viewer.locator('#screenVideo').hover();
    await viewer.getByRole('button', { name: 'Выключить звук стрима' }).hover();
    const volume = viewer.getByRole('slider', { name: 'Громкость стрима' });
    await expect(volume).toBeVisible();
    await expect(volume).toHaveAttribute('aria-orientation', 'vertical');
    await volume.press('End');
    await expect(volume).toHaveAttribute('aria-valuenow', '200');

    await share.click();
    await expect(share).toHaveAttribute('aria-pressed', 'false');
    await expect(viewer.locator('body')).not.toHaveClass(/\bscreen-view--open\b/);
  } finally {
    await publisherContext.close();
    await viewerContext.close();
  }
});
