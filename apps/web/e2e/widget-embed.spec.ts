import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultWidgetConfig, encodeWidgetConfig } from '@voice-room/shared/contracts/widget';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { startWidgetHttpsFixture, widgetOrigin, widgetParents } from './widget-https-fixture';
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing widget fixture value');
  return value;
}

async function cleanupWidgetFixtureRoom(createdCode: string | null) {
  if (createdCode && process.env.PLAYWRIGHT_WIDGET_DATABASE_URL) {
    const url = new URL(process.env.PLAYWRIGHT_WIDGET_DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/widget_test')
      throw new Error('Unsafe widget fixture database');
    const pool = new Pool({ connectionString: url.href });
    try {
      await pool.query('DELETE FROM rooms WHERE id = $1 AND kind = $2', [createdCode, 'widget']);
    } finally {
      await pool.end();
    }
  }
}

async function restoreFixtureAdmission() {
  const url = new URL(required(process.env.PLAYWRIGHT_WIDGET_DATABASE_URL));
  if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/widget_test')
    throw new Error('Unsafe recovery fixture');
  const pool = new Pool({ connectionString: url.href });
  try {
    await pool.query('UPDATE widget_boundary_activation SET widget_admission_enabled=true WHERE singleton');
  } finally {
    await pool.end();
  }
}
function recoverFixture(command: 'recover' | 'verify-disabled') {
  const database = required(process.env.PLAYWRIGHT_WIDGET_DATABASE_URL);
  const url = new URL(database);
  if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/widget_test')
    throw new Error('Unsafe recovery fixture');
  const result = spawnSync(
    process.execPath,
    [path.resolve(import.meta.dirname, '../../api/src/scripts/widget-recovery.ts'), command],
    {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        DATABASE_URL: database,
        LIVEKIT_INTERNAL_URL: 'http://127.0.0.1:17880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'devsecret'
      }
    }
  );
  expect(result.status, result.stderr).toBe(0);
  const report: unknown = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    ok: true,
    admissionDisabled: true,
    credentialsRevoked: true,
    widgetApiQuiescent: true,
    widgetGateQuiescent: true,
    widgetMediaEmpty: true,
    widgetOccupancyEmpty: true
  });
  if (
    typeof report !== 'object' ||
    report === null ||
    !('recoveryGeneration' in report) ||
    typeof report.recoveryGeneration !== 'string' ||
    !('apiOwner' in report) ||
    typeof report.apiOwner !== 'string' ||
    !('gateOwner' in report) ||
    typeof report.gateOwner !== 'string'
  )
    throw new Error('Missing recovery generation/owner evidence');
  expect(report.recoveryGeneration).toMatch(/^[1-9]\d*$/);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(report.apiOwner).toMatch(uuid);
  expect(report.gateOwner).toMatch(uuid);
  console.info(JSON.stringify({ widgetRecoveryProof: report }));
  return { generation: report.recoveryGeneration, apiOwner: report.apiOwner, gateOwner: report.gateOwner };
}
test.describe('guest widget across independent HTTPS parents', () => {
  test.skip(process.env.PLAYWRIGHT_WIDGET_E2E !== '1', 'requires isolated API3000, gate7899 and built widget');
  test.use({ ignoreHTTPSErrors: true });
  let stop: (() => void) | undefined;
  test.beforeAll(() => {
    stop = startWidgetHttpsFixture();
  });
  test.afterAll(() => {
    stop?.();
  });

  test('two guest contexts exchange real microphone/camera and text, retaining playback through collapse', async ({
    browser
  }) => {
    test.setTimeout(120_000);
    const contexts = await Promise.all(
      [0, 1].map(() => browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] }))
    );
    for (const context of contexts) {
      await context.addInitScript(() => {
        for (const key of ['localStorage', 'sessionStorage']) {
          Object.defineProperty(window, key, {
            get() {
              throw new DOMException('Storage blocked by fixture', 'SecurityError');
            }
          });
        }
      });
    }
    let createdCode: string | null = null;
    let recovered = false;
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await Promise.all(pages.map((page, index) => page.goto(required(widgetParents[index]))));
      const frames = pages.map((page) => page.frameLocator('iframe[title="VoiceRoom"]'));
      await required(frames[0]).getByLabel('Ваше имя').fill('Player One');
      await required(frames[0]).getByRole('button', { name: 'Создать комнату', exact: true }).click();
      await expect(required(frames[0]).getByRole('status')).toHaveText('В комнате', { timeout: 30_000 });
      const code = await required(frames[0]).locator('.widget-call__code').textContent();
      expect(code).toBeTruthy();
      createdCode = code;
      await required(frames[1]).getByLabel('Ваше имя').fill('Player Two');
      await required(frames[1]).getByLabel('Код комнаты').fill(required(code));
      await required(frames[1]).getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(required(frames[1]).getByRole('status')).toHaveText('В комнате', { timeout: 30_000 });
      for (const frame of frames) {
        await frame.locator('.widget-shell').hover();
        const enableAudio = frame.getByRole('button', { name: 'Включить звук', exact: true });
        if (await enableAudio.isVisible()) await enableAudio.click();
        await expect
          .poll(
            () =>
              frame
                .locator('audio')
                .evaluateAll((elements) =>
                  elements.some(
                    (element) =>
                      element instanceof HTMLMediaElement &&
                      element.srcObject instanceof MediaStream &&
                      element.srcObject.getAudioTracks().some((track) => track.readyState === 'live') &&
                      element.currentTime > 0
                  )
                ),
            { timeout: 30_000 }
          )
          .toBe(true);
      }
      await required(frames[0]).locator('.widget-shell').hover();
      await required(frames[0]).getByRole('button', { name: 'Включить камеру', exact: true }).click();
      await expect
        .poll(
          () =>
            required(frames[1])
              .locator('.participant video')
              .evaluateAll((elements) =>
                elements.some(
                  (element) =>
                    element instanceof HTMLMediaElement &&
                    element.srcObject instanceof MediaStream &&
                    element.srcObject.getVideoTracks().some((track) => track.readyState === 'live')
                )
              ),
          { timeout: 30_000 }
        )
        .toBe(true);
      for (const frame of frames) {
        await expect(frame.getByRole('button', { name: 'Текстовый чат', exact: true })).toHaveCount(0);
      }
      for (let count = 0; count < 10; count++) {
        await required(pages[0]).getByRole('button', { name: 'VoiceRoom • В звонке', exact: true }).click();
        await required(pages[0]).getByRole('button', { name: 'VoiceRoom • В звонке', exact: true }).click();
      }
      await expect(required(frames[0]).getByRole('status')).toHaveText('В комнате');
      await expect(required(frames[0]).locator('.widget-call__code')).toHaveText(required(code));
      await expect
        .poll(() =>
          required(frames[1])
            .locator('audio')
            .evaluateAll((elements) =>
              elements.some(
                (element) =>
                  element instanceof HTMLMediaElement &&
                  element.srcObject instanceof MediaStream &&
                  element.srcObject.getAudioTracks().some((track) => track.readyState === 'live') &&
                  element.currentTime > 0
              )
            )
        )
        .toBe(true);
      const denied = await required(contexts[0]).request.get(`${widgetOrigin}/api/rooms/${code}`);
      expect(denied.status()).toBe(404);
      if (process.env.PLAYWRIGHT_WIDGET_RECOVERY === '1') {
        const recovery = recoverFixture('recover');
        const verified = recoverFixture('verify-disabled');
        expect(verified).toEqual(recovery);
        await test.info().attach('widget-recovery-owner-proof', {
          body: JSON.stringify({ recovery, verified }),
          contentType: 'application/json'
        });
        recovered = true;
        for (const frame of frames) {
          await expect(frame.getByRole('status')).not.toHaveText('В комнате');
          await expect
            .poll(() =>
              frame
                .locator('audio,video')
                .evaluateAll((elements) =>
                  elements.some(
                    (element) =>
                      element instanceof HTMLMediaElement &&
                      element.srcObject instanceof MediaStream &&
                      element.srcObject.getTracks().some((track) => track.readyState === 'live')
                  )
                )
            )
            .toBe(false);
        }
      } else {
        await required(frames[0]).locator('.widget-shell').hover();
        await required(frames[0]).getByRole('button', { name: 'Выйти', exact: true }).click();
        await expect(required(frames[0]).getByRole('status')).toHaveText('Готов к подключению');
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await cleanupWidgetFixtureRoom(createdCode);
      if (recovered) await restoreFixtureAdmission();
    }
  });

  test('copy-paste hosts load independent no-referrer frames and preserve the frame on collapse', async ({
    browser
  }) => {
    const first = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
    const second = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
    try {
      const pages = await Promise.all([first.newPage(), second.newPage()]);
      for (let i = 0; i < pages.length; i++) {
        const page = required(pages[i]);
        await expect(async () => {
          const response = await page.goto(required(widgetParents[i]));
          expect(response?.ok()).toBe(true);
        }).toPass({ timeout: 20_000 });
        await expect(page.locator('iframe[title="VoiceRoom"]')).toBeVisible();
        const frame = page.frameLocator('iframe[title="VoiceRoom"]');
        await expect(frame.locator('body')).not.toBeEmpty();
        const frameUrl = await page.locator('iframe').getAttribute('src');
        expect(new URL(required(frameUrl)).origin).toBe(widgetOrigin);
        expect(new URLSearchParams(new URL(required(frameUrl)).hash.slice(1)).get('parentOrigin')).toBe(
          widgetParents[i]
        );
        const identity = await page.locator('iframe').evaluate((element) => {
          element.dataset.instanceProof = 'retained';
          if (!(element instanceof HTMLIFrameElement)) throw new Error('Expected frame');
          return element.src;
        });
        for (let count = 0; count < 10; count++) {
          await page.getByRole('button', { name: 'VoiceRoom', exact: true }).click();
          await expect(page.locator('iframe')).toHaveAttribute('inert', '');
          await page.getByRole('button', { name: 'VoiceRoom', exact: true }).click();
          await expect(page.locator('iframe')).toBeVisible();
        }
        await expect(page.locator('iframe')).toHaveAttribute('data-instance-proof', 'retained');
        await expect(page.locator('iframe')).toHaveAttribute('src', identity);
      }
    } finally {
      await first.close();
      await second.close();
    }
  });
  test('frozen initial v1 loader contract remains compatible with current embed and selected config', async ({
    page
  }) => {
    await page.goto(required(widgetParents[0]));
    const config = { ...defaultWidgetConfig, background: '#123456', radius: 7, width: 444, height: 520 };
    await page.evaluate(
      ({ origin, serialized }) => {
        document.body.replaceChildren();
        const container = document.createElement('div');
        container.dataset.v1Baseline = 'true';
        container.dataset.serviceOrigin = origin;
        container.dataset.config = serialized;
        document.body.append(container);
      },
      { origin: widgetOrigin, serialized: encodeWidgetConfig(config) }
    );
    await page.addScriptTag({
      content: readFileSync(path.join(import.meta.dirname, 'fixtures/widget-loader-v1-baseline.js.txt'), 'utf8')
    });
    const frame = page.frameLocator('iframe[title="Frozen v1 VoiceRoom"]');
    await expect(frame.getByLabel('Ваше имя')).toBeVisible();
    await expect(frame.locator('main')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await expect(frame.locator('main')).toHaveCSS('border-radius', '7px');
    const source = await page.locator('iframe[title="Frozen v1 VoiceRoom"]').getAttribute('src');
    const preserved = new URLSearchParams(new URL(required(source)).hash.slice(1)).get('config');
    expect(preserved).toBe(encodeWidgetConfig(config));
  });
});
