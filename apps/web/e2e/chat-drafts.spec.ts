import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createPermanentRoom, registerViaUi, uniqueLogin } from './helpers';

async function registerFriend(browser: Browser, baseURL: string | undefined, prefix: string): Promise<{ login: string; context: BrowserContext }> {
  const login = uniqueLogin(prefix);
  const context = await browser.newContext({ baseURL });
  await registerViaUi(await context.newPage(), login);
  return { login, context };
}

async function acceptIncomingRequests(page: Page): Promise<void> {
  const incoming = await page.context().request.get('/api/friends/requests');
  const ids = ((await incoming.json()) as { incoming?: Array<{ id: string }> }).incoming?.map((request) => request.id) ?? [];
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const accepted = await page.context().request.post(`/api/friends/requests/${id}/accept`, { data: {} });
    expect(accepted.ok()).toBe(true);
  }
}

test('unsent direct message text stays with its own thread across switches and page loads', async ({ browser, page, baseURL }) => {
  const selfLogin = uniqueLogin('draftself');
  await registerViaUi(page, selfLogin);
  const grace = await registerFriend(browser, baseURL, 'draftgrace');
  const linus = await registerFriend(browser, baseURL, 'draftlinus');
  try {
    for (const friend of [grace, linus]) {
      const request = await friend.context.request.post('/api/friends/requests', { data: { login: selfLogin } });
      expect(request.ok()).toBe(true);
    }
    await acceptIncomingRequests(page);
    await page.goto('/');

    const composer = page.getByPlaceholder('Написать сообщение…');
    const openThread = async (login: string) => {
      await page.locator('.lv-row', { hasText: login }).first().click();
      await expect(composer).toBeVisible();
    };

    await openThread(grace.login);
    await composer.fill('черновик для Грейс');
    await openThread(linus.login);
    await expect(composer).toHaveValue('');
    await composer.fill('черновик для Линуса');
    await openThread(grace.login);
    await expect(composer).toHaveValue('черновик для Грейс');

    await page.goto('/');
    await openThread(linus.login);
    await expect(composer).toHaveValue('черновик для Линуса');

    // Sending ends that draft; the other thread keeps its own.
    await composer.press('Enter');
    await expect(page.locator('.dm-chat-message', { hasText: 'черновик для Линуса' }).last()).toBeVisible();
    await expect(composer).toHaveValue('');
    await page.goto('/');
    await openThread(linus.login);
    await expect(composer).toHaveValue('');
    await openThread(grace.login);
    await expect(composer).toHaveValue('черновик для Грейс');
  } finally {
    await grace.context.close();
    await linus.context.close();
  }
});

test('unsent room chat text survives leaving the page and is gone once sent', async ({ page }) => {
  const login = uniqueLogin('draftroom');
  await registerViaUi(page, login);
  const roomName = `Drafts ${login}`;
  await createPermanentRoom(page, roomName);

  const composer = page.getByPlaceholder('Написать в комнату…');
  const openRoomChat = async () => {
    await page.locator('.lv-card', { hasText: roomName }).first().click();
    await page.getByRole('button', { name: 'Чат', exact: true }).first().click();
    await expect(composer).toBeVisible({ timeout: 20_000 });
  };

  await openRoomChat();
  await composer.fill('недописанное сообщение');
  await page.goto('/');
  await openRoomChat();
  await expect(composer).toHaveValue('недописанное сообщение');

  await composer.press('Enter');
  await expect(page.locator('.chat-msg-text', { hasText: 'недописанное сообщение' }).last()).toBeVisible();
  await page.goto('/');
  await openRoomChat();
  await expect(composer).toHaveValue('');
});
