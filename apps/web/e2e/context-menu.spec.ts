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
  await expect(menu.getByRole('menuitem', { name: 'Выключить уведомления' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Настройки комнаты' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Удалить из списка' })).toHaveCount(0);

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

test('friend rows open only the direct-message thread and do not expose a context menu', async ({ browser, page }) => {
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
    await expect(friendRow).toBeVisible();

    await friendRow.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: `Действия для ${secondLogin}` })).toHaveCount(0);
    await friendRow.click();
    await expect(page.getByPlaceholder('Написать сообщение…')).toBeVisible();
  } finally {
    await secondContext.close();
  }
});

test('bookmarked room menu can remove the room from the list but cannot open owner settings', async ({ browser, page, baseURL }) => {
  const ownerLogin = uniqueLogin('roomowner');
  const memberLogin = uniqueLogin('roommember');
  await registerViaUi(page, ownerLogin);
  const roomName = `Shared ${ownerLogin}`;
  const roomId = await createPermanentRoom(page, roomName);

  const memberContext = await browser.newContext({ baseURL });
  const member = await memberContext.newPage();
  try {
    await registerViaUi(member, memberLogin);
    const added = await memberContext.request.post('/api/auth/rooms', { data: { code: roomId } });
    expect(added.ok()).toBe(true);
    await member.reload();

    const card = member.locator('.lv-card', { hasText: roomName }).first();
    await expect(card).toBeVisible();
    await card.click({ button: 'right' });
    const menu = member.getByRole('menu', { name: `Меню комнаты ${roomName}` });
    await expect(menu.getByRole('menuitem', { name: 'Удалить из списка' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Настройки комнаты' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Удалить из списка' }).click();
    await expect(card).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
