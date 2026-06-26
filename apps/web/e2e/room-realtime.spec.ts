import { expect, test } from '@playwright/test';
import {
  createPermanentRoom,
  enterRoom,
  registerViaUi,
  roomHeading,
  openRoomSettings,
  settingsDialog,
  uniqueLogin
} from './helpers';

test('a rename by the owner propagates live to another participant without reload', async ({ browser }) => {
  const ownerLogin = uniqueLogin('rtowner');
  const guestLogin = uniqueLogin('rtguest');
  const originalName = `Realtime ${ownerLogin}`;
  const newName = `Realtime updated ${ownerLogin}`;

  // Context A: owner. Register, create room, enter it.
  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await registerViaUi(ownerPage, ownerLogin);
  const roomId = await createPermanentRoom(ownerPage, originalName);
  await enterRoom(ownerPage, roomId);
  await expect(roomHeading(ownerPage)).toHaveText(originalName);

  // Context B: a second authenticated participant opens the same room URL.
  // (Authenticated rather than guest to skip the guest-name prompt — the
  // realtime path under test is the chat-stream SSE, identical for both.)
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await registerViaUi(guestPage, guestLogin);
  await enterRoom(guestPage, roomId);
  await expect(roomHeading(guestPage)).toHaveText(originalName, { timeout: 15_000 });

  // Owner renames in context A.
  await openRoomSettings(ownerPage);
  const dialog = settingsDialog(ownerPage);
  await expect(dialog).toBeVisible();
  await dialog.locator('input.dialog-input').fill(newName);
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(roomHeading(ownerPage)).toHaveText(newName, { timeout: 15_000 });

  // Context B sees the new name pushed over SSE without a page reload.
  await expect(roomHeading(guestPage)).toHaveText(newName, { timeout: 20_000 });

  await ownerCtx.close();
  await guestCtx.close();
});

test('an owner delete propagates live to another participant without reload', async ({ browser }) => {
  const ownerLogin = uniqueLogin('rtdelowner');
  const guestLogin = uniqueLogin('rtdelguest');
  const roomName = `Realtime delete ${ownerLogin}`;

  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await registerViaUi(ownerPage, ownerLogin);
  const roomId = await createPermanentRoom(ownerPage, roomName);
  await enterRoom(ownerPage, roomId);

  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await registerViaUi(guestPage, guestLogin);
  await enterRoom(guestPage, roomId);
  await expect(roomHeading(guestPage)).toHaveText(roomName, { timeout: 15_000 });

  await openRoomSettings(ownerPage);
  const dialog = settingsDialog(ownerPage);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Удалить комнату' }).click();
  await dialog.getByRole('button', { name: 'Удалить навсегда' }).click();
  await ownerPage.waitForURL('**/', { timeout: 15_000 });

  await expect(guestPage.locator('body')).toHaveAttribute('data-screen', 'not-found', { timeout: 20_000 });
  await expect(guestPage.locator('#notFoundScreen')).toBeVisible();
  await expect(guestPage.locator('#missingRoomCode')).toHaveText(roomId);

  await ownerCtx.close();
  await guestCtx.close();
});
