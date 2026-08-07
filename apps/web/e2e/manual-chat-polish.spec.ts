import { expect, test, type Page } from '@playwright/test';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

async function enableCapabilities(page: Page, enabled: string[]): Promise<void> {
  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { features?: Record<string, boolean> };
    await route.fulfill({
      response,
      json: {
        ...body,
        features: { ...body.features, ...Object.fromEntries(enabled.map((key) => [key, true])) }
      }
    });
  });
}

test('manual polish renders the inbox between download/settings and opens it locally', async ({ page }) => {
  await enableCapabilities(page, ['engagement']);
  await page.route('**/api/notifications/inbox*', (route) => route.fulfill({
    json: {
      contractVersion: 1,
      notifications: [],
      pageInfo: { hasMore: false },
      unreadCount: 0,
      revision: 0,
      firstUnread: null
    }
  }));
  await registerViaUi(page, uniqueLogin('inboxplacement'));

  const download = page.getByRole('button', { name: 'Скачать приложение' });
  const notifications = page.getByRole('button', { name: 'Открыть уведомления' });
  const settings = page.getByRole('button', { name: 'Открыть настройки' });
  await expect(download).toBeVisible();
  await expect(notifications).toBeVisible();
  await expect(settings).toBeVisible();
  const [downloadBox, notificationBox, settingsBox] = await Promise.all([
    download.boundingBox(), notifications.boundingBox(), settings.boundingBox()
  ]);
  expect(downloadBox).not.toBeNull();
  expect(notificationBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(downloadBox!.x).toBeLessThan(notificationBox!.x);
  expect(notificationBox!.x).toBeLessThan(settingsBox!.x);

  await notifications.click();
  await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
  await expect(notifications).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toHaveCount(0);
});

test('manual polish renders direct messages with the shared flat chat row and arrow reply action', async ({ browser, page, baseURL }) => {
  await enableCapabilities(page, ['replies']);
  const firstLogin = uniqueLogin('dmflatone');
  const secondLogin = uniqueLogin('dmflattwo');
  await registerViaUi(page, firstLogin);
  const secondContext = await browser.newContext({ baseURL });
  const second = await secondContext.newPage();
  try {
    await registerViaUi(second, secondLogin);
    const request = await secondContext.request.post('/api/friends/requests', { data: { login: firstLogin } });
    expect(request.ok()).toBe(true);
    const incoming = await page.context().request.get('/api/friends/requests');
    const requestId = ((await incoming.json()) as { incoming?: Array<{ id: string }> }).incoming?.[0]?.id;
    expect(requestId).toBeTruthy();
    const accepted = await page.context().request.post(`/api/friends/requests/${requestId}/accept`, { data: {} });
    expect(accepted.ok()).toBe(true);

    await page.reload();
    await page.locator('.lv-row', { hasText: secondLogin }).first().click();
    const composer = page.getByPlaceholder('Написать сообщение…');
    await expect(composer).toBeVisible();
    await composer.fill('flat direct message');
    await composer.press('Enter');
    const messageText = page.getByText('flat direct message', { exact: true }).last();
    const message = messageText.locator('xpath=ancestor::div[contains(@class,"dm-chat-message")]');
    await expect(message).toBeVisible();
    await expect(message.locator('xpath=ancestor::div[contains(@class,"dm-chat-group")]')).toHaveAttribute('data-self', 'true');
    const style = await message.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { background: computed.backgroundColor, borderRadius: computed.borderRadius, marginLeft: computed.marginLeft };
    });
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.borderRadius).toBe('0px');
    expect(Number.parseFloat(style.marginLeft)).toBeLessThanOrEqual(0);

    await message.hover();
    const reply = message.getByRole('button', { name: 'Ответить' });
    await expect(reply).toBeVisible();
    await expect(reply.locator('svg')).toHaveCount(1);
    await reply.click();
    await expect(page.locator('.dm-reply-target')).toContainText('flat direct message');
  } finally {
    await secondContext.close();
  }
});

test('manual polish keeps the newest mention query, emits login-bound segments, and flips the picker at the viewport edge', async ({ page }) => {
  await enableCapabilities(page, ['engagement', 'reactions']);
  const login = uniqueLogin('mentionrace');
  await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, `Mention race ${login}`);

  let releaseSlow!: () => void;
  const slowResponse = new Promise<void>((resolve) => { releaseSlow = resolve; });
  let slowRequested!: () => void;
  const sawSlowRequest = new Promise<void>((resolve) => { slowRequested = resolve; });
  await page.route(`**/api/rooms/${roomId}/members?*`, async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (!query) return route.fallback();
    if (query === 'slow') {
      slowRequested();
      await slowResponse;
    }
    const stable = query === 'stable';
    await route.fulfill({
      json: {
        contractVersion: 1,
        roomId,
        members: [{
          userId: stable ? 'stable-user' : 'slow-user',
          displayName: stable ? 'Display Name That Must Not Become The Token' : 'Stale Result',
          login: stable ? 'stable_login' : 'slow_login',
          avatarColorKey: 'green',
          avatarUrl: null,
          avatarAccent: null,
          role: 'member',
          joinedAt: Date.now(),
          inVoice: false,
          presenceStatus: 'online'
        }],
        pageInfo: { hasMore: false },
        presenceRevision: stable ? 2 : 1
      }
    });
  });
  await page.route('**/api/reactions/**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, summaries: [] } });
    return route.fulfill({ json: { ok: true, summary: { emoji: '👍', count: 1, reactedByMe: true, revision: '1' } } });
  });
  let messageOrdinal = 0;
  await page.route(`**/api/rooms/${roomId}/chat`, async (route) => {
    const body = route.request().postDataJSON() as { text: string; content?: unknown; name?: string };
    messageOrdinal += 1;
    await route.fulfill({
      json: {
        message: {
          id: `manual-polish-${messageOrdinal}`,
          peerId: 'manual-polish-peer',
          authorUserId: 'manual-polish-user',
          name: body.name || login,
          text: body.text,
          content: body.content,
          createdAt: Date.now() + messageOrdinal,
          editedAt: null,
          expiresAt: Date.now() + 60_000,
          attachments: []
        }
      }
    });
  });

  await enterRoom(page, roomId);
  await page.getByRole('button', { name: 'Чат', exact: true }).click();
  const composer = page.getByPlaceholder('Написать в комнату…');
  await composer.fill('@slow');
  await sawSlowRequest;
  await composer.fill('@stable');
  const stableOption = page.getByRole('option', { name: /@stable_login/ });
  await expect(stableOption).toBeVisible();
  releaseSlow();
  await expect(page.getByRole('option', { name: /@slow_login/ })).toHaveCount(0);
  await stableOption.click();
  await expect(composer).toHaveValue('@stable_login ');
  const mentionRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`/api/rooms/${roomId}/chat`));
  await composer.press('Enter');
  const payload = (await mentionRequest).postDataJSON() as { content?: { segments?: unknown[] } };
  expect(payload.content?.segments).toEqual([{ type: 'mention', userId: 'stable-user', label: '@stable_login' }]);

  for (let index = 0; index < 16; index += 1) {
    await composer.fill(`picker row ${index}`);
    await composer.press('Enter');
  }
  await page.setViewportSize({ width: 1000, height: 420 });
  const first = page.locator('.chat-msg-text', { hasText: 'picker row 0' });
  await first.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect.poll(async () => (await first.boundingBox())?.y ?? 1000).toBeLessThan(180);
  await first.hover();
  const pickerTrigger = first.getByRole('button', { name: 'Открыть выбор эмодзи' });
  await pickerTrigger.focus();
  await pickerTrigger.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Выбор реакции' });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('data-placement', 'bottom-start');
  const pickerBox = await picker.boundingBox();
  expect(pickerBox).not.toBeNull();
  expect(pickerBox!.y).toBeGreaterThanOrEqual(8);
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(420);
});
