import { expect, test } from '@playwright/test';
import { boxOf, createPermanentRoom, incomingFriendRequestIds, registerViaUi, uniqueLogin } from './helpers';

test('room context menu supports pointer, keyboard navigation, focus restore, and viewport edges', async ({ page }) => {
  const login = uniqueLogin('context');
  const roomName = `Контекст ${login}`;

  await registerViaUi(page, login);
  await createPermanentRoom(page, roomName);

  const card = page.locator('.voice-home__card', { hasText: roomName }).first();
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

  // locator.dispatchEvent('contextmenu') builds a plain Event without coordinates.
  const openAtCorner = (clientX = 4, clientY = 4) =>
    card.evaluate(
      (element, point) =>
        element.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, ...point })
        ),
      { clientX, clientY }
    );
  await page.setViewportSize({ width: 360, height: 240 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // A visible panel can still be translating into place. Verify the final
  // collision padding at all four edges, not a frame of the entrance animation.
  const withinViewport = () =>
    expect
      .poll(async () => {
        const box = await boxOf(menu);
        return Math.min(box.x, box.y, 360 - box.x - box.width, 240 - box.y - box.height);
      })
      .toBeGreaterThanOrEqual(8);
  await openAtCorner();
  await expect(menu).toBeVisible();
  await withinViewport();

  // The far corner keeps the same margins.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await openAtCorner(356, 236);
  await expect(menu).toBeVisible();
  await withinViewport();

  await page.setViewportSize({ width: 360, height: 120 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await openAtCorner();
  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(menu).toBeVisible();
});

test('friend rows open an actions menu with a context click or keyboard and open DMs with a left click', async ({
  browser,
  page,
  baseURL
}) => {
  const firstLogin = uniqueLogin('friendone');
  const secondLogin = uniqueLogin('friendtwo');

  await registerViaUi(page, firstLogin);

  const secondContext = await browser.newContext(baseURL ? { baseURL } : {});
  const secondPage = await secondContext.newPage();
  try {
    await registerViaUi(secondPage, secondLogin);

    const requestResponse = await secondContext.request.post('/api/friends/requests', {
      data: { login: firstLogin }
    });
    expect(requestResponse.ok()).toBe(true);

    const [requestId] = await incomingFriendRequestIds(page);
    expect(requestId).toBeTruthy();

    const acceptResponse = await page.context().request.post(`/api/friends/requests/${requestId}/accept`, {
      data: {}
    });
    expect(acceptResponse.ok()).toBe(true);

    await page.reload();
    const friendRow = page.locator('.sidebar__row', { hasText: secondLogin }).first();
    await expect(friendRow).toBeVisible();

    const profile = page.getByRole('dialog', { name: `Профиль ${secondLogin}` });
    const menu = page.getByRole('menu', { name: `Действия для ${secondLogin}` });
    await friendRow.click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Написать', exact: true })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: 'Удалить из друзей' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Выключить уведомления' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Заблокировать' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(friendRow).toBeFocused();

    await friendRow.press('Shift+F10');
    await menu.getByRole('menuitem', { name: 'Профиль' }).click();
    await expect(profile).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    await friendRow.click({ button: 'right' });
    const muted = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && /\/api\/notifications\/dm\/[^/]+\/mute$/.test(response.url())
    );
    await menu.getByRole('menuitem', { name: 'Выключить уведомления' }).click();
    expect((await muted).ok()).toBe(true);
    await friendRow.click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Включить уведомления' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Заблокировать' }).click();
    const confirm = page.getByRole('dialog', { name: `Заблокировать ${secondLogin}?` });
    await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Отмена' }).click();
    await expect(confirm).toBeHidden();
    await friendRow.click();
    await expect(page.getByPlaceholder('Написать сообщение…')).toBeVisible();

    const separator = page.getByRole('separator', { name: 'Ширина боковой панели' });
    const restingColor = await separator.evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
    await separator.hover();
    const hoveredColor = await separator.evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
    expect(hoveredColor).not.toBe(restingColor);
    await separator.focus();
    await expect(separator).toHaveCSS('outline-style', 'none');

    await page.getByRole('button', { name: 'Свернуть боковую панель' }).click();
    await expect(separator).toBeHidden();
    await page.locator('.lobby-shell__sidebar-rail').locator('.sidebar__brand-mark').hover({ force: true });
    await expect(page.locator('#lobby-sidebar')).toHaveCSS('opacity', '1');
    await friendRow.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(separator).toBeHidden();
    await menu.hover();
    await expect(friendRow).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Написать', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(friendRow).toBeHidden();

    await page.locator('.lobby-shell__sidebar-rail').hover({ force: true, position: { x: 24, y: 28 } });
    await expect(page.locator('#lobby-sidebar')).toHaveCSS('opacity', '1');
    await friendRow.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Заблокировать' }).click();
    const blocked = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && /\/api\/blocks\/[^/]+$/.test(response.url())
    );
    await confirm.getByRole('button', { name: 'Заблокировать', exact: true }).click();
    expect((await blocked).ok()).toBe(true);
    await expect(friendRow).toHaveCount(0);
  } finally {
    await secondContext.close();
  }
});

test('bookmarked room menu can remove the room from the list but cannot open owner settings', async ({
  browser,
  page,
  baseURL
}) => {
  const ownerLogin = uniqueLogin('roomowner');
  const memberLogin = uniqueLogin('roommember');
  await registerViaUi(page, ownerLogin);
  const roomName = `Shared ${ownerLogin}`;
  const roomId = await createPermanentRoom(page, roomName);

  const memberContext = await browser.newContext(baseURL ? { baseURL } : {});
  const member = await memberContext.newPage();
  try {
    await registerViaUi(member, memberLogin);
    const added = await memberContext.request.post('/api/auth/rooms', { data: { code: roomId } });
    expect(added.ok()).toBe(true);
    await member.reload();

    const card = member.locator('.voice-home__card', { hasText: roomName }).first();
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
