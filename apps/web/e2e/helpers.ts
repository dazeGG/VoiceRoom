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
  await dialog.locator('.dialog-input').fill(name);
  await dialog.getByRole('button', { name: 'Создать комнату' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // The new room appears as a card in the lobby grid; grab its code.
  const card = page.locator('article.room-card', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const roomId = (await card.locator('.room-card-code').innerText()).trim();
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

// Owner-only gear button in the room topbar.
export function settingsButton(page: Page) {
  return page.getByRole('button', { name: 'Настройки комнаты' });
}

export function settingsDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Настройки комнаты' });
}
