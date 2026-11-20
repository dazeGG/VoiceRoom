import { test, expect } from '@playwright/test';
import { build } from 'vite';
import path from 'node:path';
import { startWidgetHttpsFixture, waitForWidgetHttps, widgetDist, widgetOrigin } from './widget-https-fixture';
test.describe('widget actual SFU source and data restrictions', () => {
  test.skip(process.env.PLAYWRIGHT_WIDGET_E2E !== '1', 'requires isolated widget API, gate and SFU');
  test.use({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
  let fixture: ReturnType<typeof startWidgetHttpsFixture> | undefined;
  test.beforeAll(async ({ request }) => {
    await build({
      configFile: false,
      build: {
        outDir: path.join(widgetDist, '_widget-test'),
        emptyOutDir: true,
        lib: {
          entry: path.resolve(import.meta.dirname, 'widget-boundary-client.ts'),
          formats: ['es'],
          fileName: () => 'client.js'
        }
      }
    });
    fixture = startWidgetHttpsFixture();
    await waitForWidgetHttps(request);
  });
  test.afterEach(() => fixture?.cleanupWidgetRooms());
  test.afterAll(() => fixture?.stop());
  test('SFU rejects screen sources and drops data with an unmodified widget-issued token', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(`${widgetOrigin}/embed/v1`);
    const result = await page.evaluate(async () => {
      // The bundle is emitted only into the local disposable test distribution.
      const modulePath = '/_widget-test/client.js';
      const module: unknown = await import(modulePath);
      function isProbe(value: unknown): value is { runWidgetBoundaryProbe(): Promise<unknown> } {
        return (
          typeof value === 'object' &&
          value !== null &&
          'runWidgetBoundaryProbe' in value &&
          typeof value.runWidgetBoundaryProbe === 'function'
        );
      }
      if (!isProbe(module)) throw new Error('Missing test probe');
      const value: unknown = await module.runWidgetBoundaryProbe();
      return value;
    });
    if (typeof result !== 'object' || result === null || !('roomId' in result) || typeof result.roomId !== 'string')
      throw new Error('Missing probe result');
    expect(result).toMatchObject({
      screenRejected: true,
      screenAudioRejected: true,
      forbiddenTracksReceived: 0,
      dataReceived: 0
    });
  });
});
