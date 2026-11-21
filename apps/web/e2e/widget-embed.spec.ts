import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultWidgetConfig, encodeWidgetConfig } from '@voiceroom/shared/contracts/widget';
import { expect, test } from '@playwright/test';
import {
  createWidgetRoom,
  expectWidgetAudio,
  installWidgetBrowserProbe,
  joinWidgetRoom
} from './widget-browser-fixture';
import { startWidgetHttpsFixture, waitForWidgetHttps, widgetOrigin, widgetParents } from './widget-https-fixture';
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing widget fixture value');
  return value;
}

function recoveryProof(report: unknown) {
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
  test.skip(process.env.PLAYWRIGHT_WIDGET_E2E !== '1', 'requires an isolated CI Compose project and built widget');
  test.use({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
  let fixture: ReturnType<typeof startWidgetHttpsFixture> | undefined;
  test.beforeAll(async ({ request }) => {
    fixture = startWidgetHttpsFixture();
    await waitForWidgetHttps(request);
  });
  test.afterEach(() => fixture?.cleanupWidgetRooms());
  test.afterAll(() => {
    fixture?.stop();
  });

  test('two guest contexts exchange real microphone and camera, retaining playback through collapse', async ({
    browser
  }) => {
    test.setTimeout(120_000);
    const contexts = await Promise.all(
      [0, 1].map(() => browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] }))
    );
    await Promise.all(contexts.map((context) => context.addInitScript(installWidgetBrowserProbe)));
    let recovered = false;
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await Promise.all(pages.map((page, index) => page.goto(required(widgetParents[index]))));
      const frames = pages.map((page) => page.frameLocator('iframe[title="VoiceRoom"]'));
      const code = await createWidgetRoom(required(frames[0]), 'Player One');
      await joinWidgetRoom(required(frames[1]), code, 'Player Two');
      for (const frame of frames) await expectWidgetAudio(frame);
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
        await expect(frame.getByRole('button', { name: /показать экран|демонстрация экрана/i })).toHaveCount(0);
      }
      const firstFrame = required(frames[0]);
      await firstFrame.locator('.widget-shell').hover();
      await firstFrame.getByRole('button', { name: 'Развернуть виджет', exact: true }).click();
      const restoreSize = firstFrame.getByRole('button', { name: 'Вернуть размер виджета', exact: true });
      await expect(restoreSize).toHaveAttribute('aria-pressed', 'true');
      await restoreSize.click();
      await expect(firstFrame.getByRole('button', { name: 'Развернуть виджет', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      for (let count = 0; count < 10; count++) {
        await required(pages[0]).getByRole('button', { name: 'VoiceRoom • В звонке', exact: true }).click();
        await required(pages[0]).getByRole('button', { name: 'VoiceRoom • В звонке', exact: true }).click();
      }
      await expect(required(frames[0]).getByRole('status')).toHaveText('В комнате');
      await expect(required(frames[0]).locator('.widget-call__code')).toHaveText(code);
      await expectWidgetAudio(required(frames[1]));
      const denied = await required(contexts[0]).request.get(`${widgetOrigin}/api/rooms/${code}`);
      expect(denied.status()).toBe(404);
      if (process.env.PLAYWRIGHT_WIDGET_RECOVERY === '1') {
        recovered = true;
        const recovery = recoveryProof(required(fixture).recover('recover'));
        const verified = recoveryProof(required(fixture).recover('verify-disabled'));
        expect(verified).toEqual(recovery);
        await test.info().attach('widget-recovery-owner-proof', {
          body: JSON.stringify({ recovery, verified }),
          contentType: 'application/json'
        });
        for (const frame of frames) {
          await expect(frame.getByRole('status')).not.toHaveText('В комнате');
          await expect(frame.getByLabel('Ваше имя')).toBeVisible();
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
        for (const page of pages)
          await expect(page.getByRole('button', { name: 'VoiceRoom', exact: true })).toBeVisible();
      } else {
        await required(frames[0]).locator('.widget-shell').hover();
        await required(frames[0]).getByRole('button', { name: 'Выйти', exact: true }).click();
        await expect(required(frames[0]).getByRole('status')).toHaveText('Готов к подключению');
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      if (recovered) required(fixture).restoreAdmission();
    }
  });

  test('two frames on one host keep separate same-room guests and enforce camera-off capture and subscription', async ({
    page
  }) => {
    test.setTimeout(120_000);
    await page.context().addInitScript(installWidgetBrowserProbe);
    await page.goto(`${widgetParents[0]}/multi`);
    const frames = page.locator('iframe[title="VoiceRoom"]');
    const publisher = frames.nth(0).contentFrame();
    const cameraOff = frames.nth(1).contentFrame();
    const observerPage = await page.context().newPage();
    try {
      const code = await createWidgetRoom(publisher, 'Camera Publisher');
      await joinWidgetRoom(cameraOff, code);
      await expect(publisher.getByRole('button', { name: 'Звук участника Гость', exact: true })).toHaveCount(1);
      await expect(cameraOff.getByRole('button', { name: 'Звук участника Camera Publisher', exact: true })).toHaveCount(
        1
      );
      await expectWidgetAudio(publisher);
      await expectWidgetAudio(cameraOff);
      await expect(cameraOff.getByRole('button', { name: /камер/ })).toHaveCount(0);
      await expect
        .poll(() => cameraOff.locator('body').evaluate(() => window.widgetProbe?.audioProcessors()))
        .toContain('rnnoise');

      await observerPage.goto(widgetParents[1]);
      const observer = observerPage.frameLocator('iframe[title="VoiceRoom"]');
      await joinWidgetRoom(observer, code, 'Camera Observer');
      await page.bringToFront();
      await publisher.locator('.widget-shell').hover();
      await publisher.getByRole('button', { name: 'Включить камеру', exact: true }).click();
      await observerPage.bringToFront();
      await expect
        .poll(() =>
          observer
            .locator('.participant video')
            .evaluateAll((videos) => videos.some((video) => video instanceof HTMLVideoElement && video.videoWidth > 0))
        )
        .toBe(true);
      await page.bringToFront();
      await expectWidgetAudio(cameraOff);
      await expect(cameraOff.locator('video')).toHaveCount(0);
      expect(await cameraOff.locator('body').evaluate(() => window.widgetProbe?.cameraUsage())).toEqual({
        captures: 0,
        receivedPackets: 0
      });
      await expect(publisher.getByRole('status')).toHaveText('В комнате');
      await expect(cameraOff.getByRole('status')).toHaveText('В комнате');
    } finally {
      await observerPage.close();
      await page.close();
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
