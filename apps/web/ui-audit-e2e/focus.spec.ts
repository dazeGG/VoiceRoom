import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, chromium, type BrowserContext, type Route } from '@playwright/test';
const frontendByPort: Record<number, string> = { 15181: 'admin', 15180: 'web', 15182: 'site' };
const selectedFrontend = process.env['UI_AUDIT_FRONTEND'];
function includesFrontend(port: number): boolean {
  return !selectedFrontend || frontendByPort[port] === selectedFrontend;
}
function isolateNetwork(route: Route) {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/auth/whats-new')
      return route.fulfill({ json: { ok: true, whatsNew: { current: '2.8.0', lastSeen: null } } });
    if (url.pathname === '/api/auth/whats-new/seen')
      return route.fulfill({ json: { ok: true, whatsNew: { current: '2.8.0', lastSeen: '2.8.0' } } });
    return route.fulfill({ status: 503, json: { ok: false, error: 'Isolated fixture' } });
  }
  if (url.hostname === '127.0.0.1' && ['15180', '15181', '15182'].includes(url.port)) return route.continue();
  return route.abort();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', isolateNetwork);
});
test('admin modal blocks global search focus', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  await page.getByRole('button', { name: 'Open modal' }).click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Draft');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Reason' })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Fixture modal' })).toBeVisible();
  expect(
    await page.getByRole('dialog', { name: 'Fixture modal' }).evaluate((el) => el.contains(document.activeElement))
  ).toBe(true);
});
test('popover returns focus on Escape', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Dates', exact: true })).toBeFocused();
});
test('radio arrows select next period', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  await page.getByRole('radio', { name: 'Day' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
});
test('story final slide keeps reverse focus inside', async ({ page }) => {
  await page.goto('http://127.0.0.1:15180/test/browser/');
  await expect(page.locator('.stories__stage')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+Tab');
  expect(await page.locator('.stories__card').evaluate((el) => el.contains(document.activeElement))).toBe(true);
});
test('capture default typography', async ({ page }, info) => {
  for (const [name, port] of [
    ['admin', 15181],
    ['web', 15180],
    ['site', 15182]
  ] as const) {
    if (!includesFrontend(port)) continue;
    await page.goto('http://127.0.0.1:' + String(port) + (name === 'site' ? '/' : '/test/browser/'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
    await writeFile(
      info.outputPath(name + '-sizes.json'),
      JSON.stringify(
        await page
          .locator('button,input,label,h1,h2,p,a')
          .evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent, size: getComputedStyle(n).fontSize }))),
        null,
        2
      )
    );
    await info.attach(name + '-sizes', {
      body: JSON.stringify(
        await page
          .locator('button,input,label,h2')
          .evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent, size: getComputedStyle(n).fontSize })))
      ),
      contentType: 'application/json'
    });
  }
});

test('admin modal blocks programmatic background focus and resets account forms', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  for (const kind of ['block', 'delete']) {
    await page.getByRole('button', { name: 'Open ' + kind }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Причина', { exact: true }).fill('Fixture reason');
    await page.getByText('Outside', { exact: true }).evaluate((el) => el.focus());
    expect(await modal.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open ' + kind }).click();
    await expect(modal.getByLabel('Причина', { exact: true })).toHaveValue('');
    await modal.getByLabel('Причина', { exact: true }).fill('Fixture reason');
    if (kind === 'delete') await modal.getByRole('textbox', { name: /Введите логин/ }).fill('fixture');
    await modal
      .getByRole('button', { name: kind === 'block' ? 'Заблокировать' : 'Удалить аккаунт', exact: true })
      .click();
    await expect(modal).toHaveCount(0);
  }
  await expect(page.getByLabel('Submissions')).toHaveText('2');
});
test('popover outside click keeps destination focus', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).focus();
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Outside', exact: true })).toBeFocused();
});
test('story hands focus to appearance dialog', async ({ page }) => {
  await page.goto('http://127.0.0.1:15180/test/browser/');
  await expect(page.locator('.stories__stage')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Настроить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Appearance', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.stories__card')).toHaveCount(0);
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});
test('story pauses for urgent dialog without marking seen', async ({ page }) => {
  let seen = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/whats-new/seen')) seen++;
  });
  await page.goto('http://127.0.0.1:15180/test/browser/');
  await expect(page.locator('.stories__stage')).toBeFocused();
  await page.getByRole('button', { name: 'Urgent', exact: true, includeHidden: true }).evaluate((el) => {
    if (el instanceof HTMLElement) el.click();
  });
  const dialog = page.getByRole('dialog', { name: 'Urgent', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(seen).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.stories__stage')).toBeFocused();
  expect(seen).toBe(0);
});
test('custom range retains unchecked presets until explicit choice', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  await page.getByRole('button', { name: 'Свой период', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Период', exact: true });
  await dialog.getByLabel('С', { exact: true }).fill('2026-11-01');
  await dialog.getByLabel('По', { exact: true }).fill('2026-11-10');
  await dialog.getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(page.getByLabel('Range', { exact: true })).toHaveText('custom');
  const group = page.getByRole('radiogroup', { name: 'Период', exact: true });
  await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);
  await group.getByRole('radio').first().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Range', { exact: true })).toHaveText('custom');
  await group.getByRole('radio').first().focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Range', { exact: true })).toHaveText('preset');
});
test('dialog content and drag do not dismiss but backdrop does', async ({ page }) => {
  await page.goto('http://127.0.0.1:15181/test/browser/');
  const opener = page.getByRole('button', { name: 'Open modal' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Fixture modal' });
  await dialog.click({ position: { x: 8, y: 8 } });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (!box) throw new Error('Dialog missing');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await opener.click();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  }
});
test('browser default font preference scales text without root overrides', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Browser preference control uses Chromium CDP; no CSS override.');
  const cdp = await page.context().newCDPSession(page);
  for (const [port, path, selector] of [
    [15181, '/test/browser/', '.ui-button'],
    [15180, '/test/browser/', '.stories__title'],
    [15182, '/', '.site-header__brand']
  ] as const) {
    if (!includesFrontend(port)) continue;
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16 } });
    await page.goto('http://127.0.0.1:' + String(port) + path);
    await expect(page.locator(selector).first()).toBeVisible();
    const bodyBefore = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    const before = await page
      .locator(selector)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    for (const size of [20, 24, 32]) {
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: size } });
      await page.reload();
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(size);
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBeCloseTo(
        (bodyBefore * size) / 16,
        1
      );
      const after = await page
        .locator(selector)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(after).toBeCloseTo((before * size) / 16, 1);
      if (port === 15181) {
        for (const [sample, normal] of [
          ['.ui-nav__text', 14],
          ['.admin-product__table td', 13.5]
        ] as const) {
          expect(
            await page
              .locator(sample)
              .first()
              .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
          ).toBeCloseTo((normal * size) / 16, 1);
        }
      }
      if (port === 15180)
        expect(await page.getByTestId('chat-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(
          size
        );
    }
  }
  await cdp.detach();
});

// Representative text at a 16px browser default (1280x900).
test('F6 retains representative default text sizes', async ({ page }) => {
  for (const [port, path, samples] of [
    [
      15181,
      '/test/browser/',
      [
        ['.ui-button', 14],
        ['.admin-product__table td', 13.5],
        ['.admin-product__table th', 12]
      ]
    ],
    [
      15180,
      '/test/browser/',
      [
        ['[data-testid="chat-text"]', 16],
        ['.stories__title', 18],
        ['.stories__quiet', 13]
      ]
    ],
    [15182, '/', [['.site-header__brand', 17]]]
  ] as const) {
    if (!includesFrontend(port)) continue;
    await page.goto(`http://127.0.0.1:${port}${path}`);
    for (const [selector, size] of samples) {
      await expect(page.locator(selector).first()).toBeAttached();
      expect(
        await page
          .locator(selector)
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      ).toBeCloseTo(size, 1);
    }
  }
});

test('F6 enlarged text keeps dialog actions keyboard reachable and tables scrollable', async ({
  page,
  browserName
}) => {
  test.skip(browserName !== 'chromium', 'Uses actual Chromium browser default font preference.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
  if (includesFrontend(15181)) {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('http://127.0.0.1:15181/test/browser/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const table = page.getByTestId('retention-scroll');
    expect(
      await table.evaluate(
        (el) => el.scrollWidth <= el.clientWidth || ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)
      )
    ).toBe(true);
    const navGeometry = await page.locator('.ui-nav__text').evaluateAll((labels) =>
      labels.map((el) => {
        const row = el.closest('.ui-nav__item');
        const bounds = el.getBoundingClientRect();
        const rowBounds = row?.getBoundingClientRect();
        return {
          text: el.textContent,
          labelHeight: bounds.height,
          rowHeight: rowBounds?.height,
          labelRight: bounds.right,
          rowRight: rowBounds?.right,
          client: el.clientWidth,
          scroll: el.scrollWidth,
          fits:
            !!rowBounds &&
            bounds.right <= rowBounds.right &&
            bounds.height <= rowBounds.height &&
            el.scrollWidth <= el.clientWidth
        };
      })
    );
    expect(navGeometry.filter((item) => !item.fits)).toEqual([]);
    await page.getByRole('button', { name: 'Open block' }).click();
    await page.getByLabel('Причина', { exact: true }).fill('Enlarged text');
    expect(
      await page.getByLabel('Причина', { exact: true }).evaluate((el) => {
        const style = getComputedStyle(el);
        return (
          el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) >=
          parseFloat(style.lineHeight)
        );
      })
    ).toBe(true);
    const submit = page.getByRole('button', { name: 'Заблокировать', exact: true });
    for (let i = 0; i < 8 && !(await submit.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await expect(submit).toBeInViewport();
    await page.keyboard.press('Escape');
  }
  if (includesFrontend(15180)) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:15180/test/browser/');
    await expect(page.locator('.stories__stage')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const configure = page.getByRole('button', { name: 'Настроить', exact: true });
    for (let i = 0; i < 8 && !(await configure.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(configure).toBeFocused();
    await expect(configure).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (includesFrontend(15182)) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:15182/');
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.locator('body *').evaluateAll((nodes) =>
      nodes
        .map((el) => ({
          cls: el.getAttribute('class') ?? '',
          right: el.getBoundingClientRect().right,
          scroll: el.scrollWidth,
          width: el.clientWidth
        }))
        .filter((el) => el.right > innerWidth + 1 || el.scroll > el.width + 1)
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      JSON.stringify({
        overflow,
        sizes: await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
      })
    ).toBe(true);
    const menu = page.locator('.site-menu__toggle');
    await menu.focus();
    await expect(menu).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('.site-menu')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    expect(await page.locator('.site-menu__drawer').evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await cdp.detach();
});

test('F6 real browser page zoom retains actions at 200 percent', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Chrome extension tabs.setZoom controls genuine browser page zoom.');
  const extension = await mkdtemp(join(tmpdir(), 'voiceroom-ui-audit-zoom-'));
  let context: BrowserContext | undefined;
  try {
    await writeFile(
      extension + '/manifest.json',
      JSON.stringify({
        manifest_version: 3,
        name: 'Isolated UI audit zoom',
        version: '1.0',
        permissions: ['tabs'],
        background: { service_worker: 'background.js' }
      })
    );
    await writeFile(extension + '/background.js', 'chrome.runtime.onInstalled.addListener(() => {});');
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.route('**/*', isolateNetwork);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = context.pages()[0] ?? (await context.newPage());
    for (const [port, path] of [
      [15181, '/test/browser/'],
      [15180, '/test/browser/'],
      [15182, '/']
    ] as const) {
      if (!includesFrontend(port)) continue;
      await page.goto(`http://127.0.0.1:${port}${path}`);
      await worker.evaluate(
        `(async () => { const [tab] = await chrome.tabs.query({active:true}); await chrome.tabs.setZoom(tab.id, 1); })()`
      );
      const initial = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio }));
      await worker.evaluate(
        `(async () => { const [tab] = await chrome.tabs.query({active:true}); await chrome.tabs.setZoom(tab.id, 2); })()`
      );
      expect(
        await worker.evaluate(
          `(async () => { const [tab] = await chrome.tabs.query({active:true}); return chrome.tabs.getZoom(tab.id); })()`
        )
      ).toBe(2);
      await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(initial.ratio * 2);
      expect(await page.evaluate(() => innerWidth)).toBeCloseTo(initial.width / 2, 0);
      if (port === 15181) {
        await page.getByRole('button', { name: 'Open modal' }).click();
        await page.getByLabel('Reason').fill('Zoomed');
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
        await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
        await page.keyboard.press('Escape');
      } else if (port === 15180) {
        await expect(page.locator('.stories__stage')).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        const configure = page.getByRole('button', { name: 'Настроить', exact: true });
        for (let i = 0; i < 8 && !(await configure.evaluate((el) => el === document.activeElement)); i++)
          await page.keyboard.press('Tab');
        await expect(configure).toBeFocused();
        await expect(configure).toBeInViewport();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();
      } else {
        await expect(page.locator('.site-header__brand').first()).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.screenshot({ path: info.outputPath('zoom-' + String(port) + '.png') });
    }
  } finally {
    try {
      await context?.close();
    } finally {
      await rm(extension, { recursive: true, force: true });
    }
  }
});

test('F2 computed muted text contrast on real table and chat surfaces', async ({ page }) => {
  for (const [port, selectors] of [
    [15181, ['.admin-product__table th']],
    [15180, ['.room-chat-group__time', '.room-chat-group__edited']]
  ] as const) {
    if (!includesFrontend(port)) continue;
    await page.goto(`http://127.0.0.1:${port}/test/browser/`);
    for (const selector of selectors) {
      const ratio = await page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No canvas color conversion');
          function luminance(color: string) {
            if (!ctx) throw new Error('No canvas');
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((c) => {
                const v = c / 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
          }
          let parent: Element | null = el;
          let background = 'rgba(0, 0, 0, 0)';
          while (parent && background === 'rgba(0, 0, 0, 0)') {
            background = getComputedStyle(parent).backgroundColor;
            parent = parent.parentElement;
          }
          const foreground = luminance(getComputedStyle(el).color);
          const back = luminance(background);
          return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05);
        });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
});

for (const locale of ['en', 'fr']) {
  test(`F6 web ${locale} enlarged localized story actions remain reachable`, async ({ page, browserName }) => {
    test.skip(!includesFrontend(15180), 'Separate frontend acceptance gate.');
    test.skip(browserName !== 'chromium', 'Uses actual browser font preference.');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:15180/test/browser/?locale=${locale}`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('.stories__stage')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const configure = page.locator('.stories__actions .ui-button--ghost');
    for (let i = 0; i < 8 && !(await configure.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(configure).toBeFocused();
    await expect(configure).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();
    await cdp.detach();
  });
}

// Real TypingIndicator plus existing host/row/input markup; no chat session or transport.
test('composer typing reservation grows with browser font preference', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Uses actual Chromium browser font preference.');
  const cdp = await page.context().newCDPSession(page);
  const measurements: { size: number; host: string; overlap: number }[] = [];
  for (const size of [16, 20, 24, 32]) {
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: size } });
    await page.goto('http://127.0.0.1:15180/test/browser/');
    for (const host of ['dm', 'room']) {
      const geometry = await page.getByTestId(`${host}-typing-host`).evaluate((el) => {
        const indicator = el.querySelector('.typing-indicator');
        const row = el.querySelector('.attachment-compose');
        if (!indicator || !row) throw new Error('Missing real typing fixture');
        return { indicatorBottom: indicator.getBoundingClientRect().bottom, rowTop: row.getBoundingClientRect().top };
      });
      measurements.push({ size, host, overlap: geometry.indicatorBottom - geometry.rowTop });
    }
  }
  await info.attach('typing-geometry', { body: JSON.stringify(measurements), contentType: 'application/json' });
  expect(measurements.filter((item) => item.overlap > 0)).toEqual([]);
  await cdp.detach();
});
