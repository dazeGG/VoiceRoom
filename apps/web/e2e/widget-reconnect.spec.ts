import { expect, test } from '@playwright/test';
import {
  createWidgetRoom,
  expectWidgetAudio,
  installWidgetBrowserProbe,
  joinWidgetRoom
} from './widget-browser-fixture';
import { startWidgetHttpsFixture, waitForWidgetHttps, widgetParents } from './widget-https-fixture';

test.describe('widget guest session recovery', () => {
  test.skip(process.env.PLAYWRIGHT_WIDGET_E2E !== '1', 'requires an isolated CI Compose project and built widget');
  test.use({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
  let fixture: ReturnType<typeof startWidgetHttpsFixture> | undefined;

  test.beforeAll(async ({ request }) => {
    fixture = startWidgetHttpsFixture();
    await waitForWidgetHttps(request);
  });
  test.afterEach(() => fixture?.cleanupWidgetRooms());
  test.afterAll(() => fixture?.stop());

  test('recovers roster and voice behind a collapsed launcher without replacing the guest', async ({ page }) => {
    test.setTimeout(120_000);
    await page.context().addInitScript(installWidgetBrowserProbe);
    await page.goto(`${widgetParents[0]}/multi`);
    const frames = page.locator('iframe[title="VoiceRoom"]');
    const iframe = frames.nth(0);
    const alice = iframe.contentFrame();
    const bob = frames.nth(1).contentFrame();
    const launcher = page.getByRole('button', { name: 'VoiceRoom • В звонке', exact: true });
    const aliceOnBob = bob.getByRole('button', { name: 'Звук участника Alice', exact: true });
    const sockets = () => alice.locator('body').evaluate(() => window.widgetProbe?.sockets());
    const setOffline = (value: boolean) =>
      alice.locator('body').evaluate((_, offline) => window.widgetProbe?.setOffline(offline), value);

    try {
      const code = await createWidgetRoom(alice, 'Alice');
      await joinWidgetRoom(bob, code, 'Bob');
      await expectWidgetAudio(alice);
      await expectWidgetAudio(bob);
      const aliceId = await aliceOnBob.getAttribute('data-peer-id');
      if (!aliceId) throw new Error('Missing roster identity for Alice');
      const before = await sockets();
      expect(before?.roster).toBeGreaterThan(0);
      expect(before?.signal).toBeGreaterThan(0);

      await launcher.click();
      await expect(iframe).toHaveAttribute('inert', '');
      await setOffline(true);
      const status = alice.locator('.widget-call [role="status"]');
      await expect(status).toHaveText('Связь потеряна. Переподключение…');
      await expect(alice.locator('.widget-call__code')).toHaveText(code);
      await expect(launcher).toHaveAttribute('aria-expanded', 'false');
      await setOffline(false);

      await expect
        .poll(async () => (await sockets())?.roster, { timeout: 30_000 })
        .toBeGreaterThan(before?.roster ?? 0);
      await expect
        .poll(async () => (await sockets())?.signal, { timeout: 30_000 })
        .toBeGreaterThan(before?.signal ?? 0);
      await expect(status).toHaveText('В комнате', { timeout: 30_000 });
      await expect(iframe).toHaveAttribute('inert', '');
      await launcher.click();
      await expect(alice.locator('.widget-call__code')).toHaveText(code);
      await expect(aliceOnBob).toHaveCount(1);
      await expect(aliceOnBob).toHaveAttribute('data-peer-id', aliceId);
      await expectWidgetAudio(alice);
      await expectWidgetAudio(bob);

      await alice.locator('.widget-shell').hover();
      await alice.getByRole('button', { name: 'Выйти', exact: true }).click();
      await expect(alice.getByRole('status')).toHaveText('Готов к подключению');
      await expect(aliceOnBob).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});
