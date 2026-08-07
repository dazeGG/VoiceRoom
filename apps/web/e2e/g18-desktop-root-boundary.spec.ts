import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const BLOCKED_ROUTES = ['/', '/login', '/register', '/r/g18-fixture-room'];

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: MOBILE_UA,
    viewport: { width: 320, height: 720 },
    serviceWorkers: 'allow'
  });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      configurable: true,
      get: () => ({ mobile: true, platform: 'Android' })
    });
  });
  return context;
}

function collectProhibitedCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || /livekit/i.test(url.hostname)) {
      calls.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    if (url.pathname.startsWith('/api/') || /livekit/i.test(url.hostname)) calls.push(`WS ${socket.url()}`);
  });
  return calls;
}

test('G18-A01 blocks every entry route before child effects mount', async ({ browser }) => {
  const context = await mobileContext(browser);
  try {
    for (const route of BLOCKED_ROUTES) {
      const page = await context.newPage();
      const prohibitedCalls = collectProhibitedCalls(page);
      await page.goto(route);
      const boundary = page.getByRole('main', { name: 'Неподдерживаемое устройство' });
      await expect(boundary).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Откройте Voice Room на компьютере' })).toBeVisible();
      await expect(page.locator('main[aria-label="Неподдерживаемое устройство"]')).toHaveCount(1);
      await page.waitForTimeout(250);
      expect(prohibitedCalls, `${route} issued prohibited calls`).toEqual([]);
      await page.close();
    }
  } finally {
    await context.close();
  }
});

test('G18-A02 registered mobile service worker suppresses a delivered push notification', async ({ browser, baseURL }) => {
  const origin = baseURL ?? 'http://127.0.0.1:5180';
  const context = await mobileContext(browser);
  await context.grantPermissions(['notifications'], { origin });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'Неподдерживаемое устройство' })).toBeVisible();
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    const registration = new Promise<string>((resolve) => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const match = registrations.find((item: { scopeURL: string }) => item.scopeURL === `${origin}/`);
        if (match) resolve(match.registrationId);
      });
    });
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
      await navigator.serviceWorker.ready;
    });
    const registrationId = await registration;
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId,
      data: JSON.stringify({ title: 'must-not-render', body: 'blocked mobile push' })
    });
    await page.waitForTimeout(250);
    const notifications = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready;
      return (await worker.getNotifications()).map(({ title }) => title);
    });
    expect(notifications).toEqual([]);
  } finally {
    await context.close();
  }
});

test('G18-A02 narrow desktop remains allowed', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: DESKTOP_UA, viewport: { width: 320, height: 720 } });
  const page = await context.newPage();
  try {
    await page.goto('/login');
    await expect(page.getByRole('dialog', { name: 'Вход' })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Неподдерживаемое устройство' })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-desktop-boundary', 'allowed');
  } finally {
    await context.close();
  }
});
