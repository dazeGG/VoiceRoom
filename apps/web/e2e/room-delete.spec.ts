import { expect, test } from '@playwright/test';
import {
  createPermanentRoom,
  enterRoom,
  registerViaUi,
  settingsButton,
  settingsDialog,
  uniqueLogin
} from './helpers';

test('owner can delete a room: redirected home, gone from list, direct URL is not-found', async ({ page }) => {
  const login = uniqueLogin('del');
  const roomName = `Удаляемая ${login}`;

  await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, roomName);

  await enterRoom(page, roomId);

  // Open settings -> reveal danger zone -> two-step confirm.
  await settingsButton(page).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Удалить комнату' }).click();
  await dialog.getByRole('button', { name: 'Удалить навсегда' }).click();

  // Delete redirects to the home/lobby ("/").
  await page.waitForURL('**/', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });

  // The deleted room is gone from the owned-rooms list.
  await expect(page.locator('article.room-card', { hasText: roomName })).toHaveCount(0, { timeout: 15_000 });

  // Navigating directly to the deleted room URL shows the not-found screen.
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'not-found', { timeout: 20_000 });
  await expect(page.locator('#notFoundScreen')).toBeVisible();
  await expect(page.locator('#missingRoomCode')).toHaveText(roomId);
});
