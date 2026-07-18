import { expect, test } from '@playwright/test';
import {
  createPermanentRoom,
  enterRoom,
  openRoomSettings,
  registerViaUi,
  roomHeading,
  settingsDialog,
  uniqueLogin
} from './helpers';

test('owner can rename a room, reflected in-room and in the lobby', async ({ page }) => {
  const login = uniqueLogin('edit');
  const originalName = `Комната ${login}`;
  const newName = `Переименована ${login}`;

  await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, originalName);

  await enterRoom(page, roomId);
  await expect(roomHeading(page)).toHaveText(originalName);

  await openRoomSettings(page);
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder('Название комнаты').fill(newName);
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // In-room heading updates live.
  await expect(roomHeading(page)).toHaveText(newName, { timeout: 15_000 });

  // Back in the lobby the card shows the new name.
  await page.goto('/');
  const card = page.locator('.lv-card', { hasText: newName }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.lv-row-name')).toHaveText(newName);
});
