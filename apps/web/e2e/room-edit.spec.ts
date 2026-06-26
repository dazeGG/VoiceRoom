import { expect, test } from '@playwright/test';
import {
  createPermanentRoom,
  enterRoom,
  registerViaUi,
  roomHeading,
  settingsButton,
  settingsDialog,
  uniqueLogin
} from './helpers';

test('owner can rename a room and change its preset, reflected in-room and in the lobby', async ({ page }) => {
  const login = uniqueLogin('edit');
  const originalName = `Комната ${login}`;
  const newName = `Переименована ${login}`;

  await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, originalName);

  await enterRoom(page, roomId);
  await expect(roomHeading(page)).toHaveText(originalName);

  // Owner-only gear button opens the settings dialog.
  await expect(settingsButton(page)).toBeVisible();
  await settingsButton(page).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();

  // Rename + pick a different visual preset (default is the first emoji 🎧;
  // choose the gamepad 🎮 preset to force a change).
  await dialog.locator('input.dialog-input').fill(newName);
  await dialog.getByRole('radio', { name: '🎮' }).click();
  await expect(dialog.getByRole('radio', { name: '🎮' })).toHaveAttribute('aria-checked', 'true');

  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // In-room heading updates live.
  await expect(roomHeading(page)).toHaveText(newName, { timeout: 15_000 });
  // The emoji badge in the topbar reflects the new preset.
  await expect(page.locator('#roomEmojiBadge')).toHaveText('🎮', { timeout: 15_000 });

  // Back in the lobby the card shows the new name.
  await page.goto('/');
  const card = page.locator('article.room-card', { hasText: newName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.room-card-name')).toHaveText(newName);
  await expect(card.locator('.room-card-emoji')).toHaveText('🎮');
});
