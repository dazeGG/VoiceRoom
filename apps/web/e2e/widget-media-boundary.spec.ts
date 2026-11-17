import { test, expect } from '@playwright/test';
import { build } from 'vite';
import path from 'node:path';
import { Pool } from 'pg';
import { startWidgetHttpsFixture, widgetOrigin } from './widget-https-fixture';
test.describe('widget actual SFU source and data restrictions', () => {
  test.skip(process.env.PLAYWRIGHT_WIDGET_E2E !== '1', 'requires isolated widget API, gate and SFU');
  test.use({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
  let stop: (() => void) | undefined;
  test.beforeAll(async () => {
    await build({
      configFile: false,
      build: {
        outDir: path.resolve(import.meta.dirname, '../dist/_widget-test'),
        emptyOutDir: true,
        lib: {
          entry: path.resolve(import.meta.dirname, 'widget-boundary-client.ts'),
          formats: ['es'],
          fileName: () => 'client.js'
        }
      }
    });
    stop = startWidgetHttpsFixture();
  });
  test.afterAll(() => stop?.());
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
    const database = process.env.PLAYWRIGHT_WIDGET_DATABASE_URL;
    if (!database) throw new Error('Expected explicit disposable widget database');
    const url = new URL(database);
    if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/widget_test')
      throw new Error('Unsafe fixture database');
    const pool = new Pool({ connectionString: url.href });
    try {
      await pool.query('DELETE FROM rooms WHERE id = $1 AND kind = $2', [result.roomId, 'widget']);
    } finally {
      await pool.end();
    }
    expect(result).toMatchObject({
      screenRejected: true,
      screenAudioRejected: true,
      forbiddenTracksReceived: 0,
      dataReceived: 0
    });
  });
});
