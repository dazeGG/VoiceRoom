import { expect, test } from '@playwright/test';
import { createPermanentRoom, registerViaUi, uniqueLogin } from './helpers';

test('room context menu supports pointer, keyboard navigation, focus restore, and viewport edges', async ({ page }) => {
  const login = uniqueLogin('context');
  const roomName = `Контекст ${login}`;

  await registerViaUi(page, login);
  await createPermanentRoom(page, roomName);

  const card = page.locator('.lv-card', { hasText: roomName }).first();
  const menu = page.getByRole('menu', { name: `Меню комнаты ${roomName}` });
  const items = menu.getByRole('menuitem');

  await card.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(items.first()).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(card).toBeFocused();

  await card.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 360, height: 240 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await card.dispatchEvent('contextmenu', {
    bubbles: true,
    button: 2,
    buttons: 2,
    cancelable: true,
    clientX: 4,
    clientY: 4
  });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(352);
  expect(box!.y + box!.height).toBeLessThanOrEqual(232);

  await page.setViewportSize({ width: 360, height: 120 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await card.dispatchEvent('contextmenu', {
    bubbles: true,
    button: 2,
    buttons: 2,
    cancelable: true,
    clientX: 4,
    clientY: 4
  });
  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(menu).toBeVisible();
});

test('friend context menu opens from pointer and keyboard in the sidebar', async ({ browser, page }) => {
  const firstLogin = uniqueLogin('friendone');
  const secondLogin = uniqueLogin('friendtwo');

  await registerViaUi(page, firstLogin);

  const secondContext = await browser.newContext({ baseURL: 'http://localhost:5180' });
  const secondPage = await secondContext.newPage();
  try {
    await registerViaUi(secondPage, secondLogin);

    const requestResponse = await secondContext.request.post('/api/friends/requests', {
      data: { login: firstLogin }
    });
    expect(requestResponse.ok()).toBe(true);

    const requestsResponse = await page.context().request.get('/api/friends/requests');
    expect(requestsResponse.ok()).toBe(true);
    const requests = (await requestsResponse.json()) as { incoming?: Array<{ id: string }> };
    const requestId = requests.incoming?.[0]?.id;
    expect(requestId).toBeTruthy();

    const acceptResponse = await page.context().request.post(`/api/friends/requests/${requestId}/accept`, {
      data: {}
    });
    expect(acceptResponse.ok()).toBe(true);

    await page.reload();
    const friendRow = page.locator('.lv-row', { hasText: secondLogin }).first();
    const friendMenu = page.getByRole('menu', { name: `Действия для ${secondLogin}` });
    await expect(friendRow).toBeVisible();

    await friendRow.click({ button: 'right' });
    await expect(friendMenu).toBeVisible();
    await expect(friendMenu.getByRole('menuitem', { name: 'Открыть сообщения' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(friendRow).toBeFocused();

    await friendRow.focus();
    await page.keyboard.press('Shift+F10');
    await expect(friendMenu.getByRole('menuitem', { name: 'Удалить из друзей' })).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
