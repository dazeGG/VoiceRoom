import { expect, type Page } from '@playwright/test';

// Unique-per-run credentials. The login allows [a-z0-9_], 3-32 chars, so
// keep it lowercase alphanumeric.
export function uniqueLogin(prefix = 'e2e'): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}${stamp}`.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

export const PASSWORD = 'e2e-password-123';

// Register a fresh account through the UI. On success the app redirects to
// the lobby ("/"), where the create-room button is visible.
export async function registerViaUi(page: Page, login: string): Promise<void> {
  await page.goto('/register');
  await page.locator('#loginInput').fill(login);
  await page.locator('#passwordInput').fill(PASSWORD);
  await page.locator('#passwordConfirmInput').fill(PASSWORD);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  // Lobby create button confirms we landed authenticated.
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });
}

// Log in through the UI for a second browser context that should share an
// existing account.
export async function loginViaUi(page: Page, login: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#loginInput').fill(login);
  await page.locator('#passwordInput').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });
}

// Create a permanent ("Постоянная") room from the lobby via the create dialog.
// Returns the roomId read off the resulting room card.
export async function createPermanentRoom(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая комната' });
  await expect(dialog).toBeVisible();
  // "Постоянная" tab is the default, but click it to be explicit.
  await dialog.getByRole('tab', { name: 'Постоянная' }).click();
  await dialog.locator('.lr-dialog-input').fill(name);
  const createdResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST' && response.ok()
  );
  await dialog.getByRole('button', { name: 'Создать комнату' }).click();
  const created = (await (await createdResponse).json()) as { roomId?: string };
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // The new room appears as a card in the lobby grid.
  const card = page.locator('.lv-card', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const roomId = created.roomId?.trim() || '';
  expect(roomId).toMatch(/^[a-z0-9]+$/i);
  return roomId;
}

// Navigate directly to a room and wait for the in-room topbar heading to
// render (body[data-screen="room"]). Authenticated users skip the guest
// name prompt, so the room screen appears automatically.
export async function enterRoom(page: Page, roomId: string): Promise<void> {
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'room', { timeout: 20_000 });
  await expect(page.locator('#roomTitle')).toBeVisible({ timeout: 20_000 });
}

export function roomHeading(page: Page) {
  return page.locator('#roomTitle');
}

export function roomHeadingMenuButton(page: Page) {
  return page.locator('.room-heading-trigger');
}

export async function openRoomHeadingMenu(page: Page): Promise<void> {
  await roomHeadingMenuButton(page).click();
}

// Owner-only settings action sits beside the shared room menu so preview and
// active-room menus keep an identical action set.
export function roomSettingsButton(page: Page) {
  return page.getByRole('button', { name: 'Настройки', exact: true });
}

export async function openRoomSettings(page: Page): Promise<void> {
  await roomSettingsButton(page).click();
}

export function settingsDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Настройки комнаты' });
}
