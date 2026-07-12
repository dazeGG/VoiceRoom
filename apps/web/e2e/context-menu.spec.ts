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
  await card.click({ button: 'right', position: { x: 4, y: 4 } });
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(352);
  expect(box!.y + box!.height).toBeLessThanOrEqual(232);
});
