import { expect, type Page } from '@playwright/test';

export async function waitForHttpReady(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return;
      lastError = new Error(`readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`readiness timeout for ${url}`, { cause: lastError });
}

// Unique-per-run credentials. The login allows [a-z0-9_], 3-32 chars, so
// keep it lowercase alphanumeric.
export function uniqueLogin(prefix = 'e2e'): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}${stamp}`.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

export const PASSWORD = 'e2e-password-123';

function authDialog(page: Page, name: 'Вход' | 'Создать аккаунт') {
  return page.getByRole('dialog', { name });
}

// Register a fresh account through the UI. On success the app redirects to
// the lobby ("/"), where the create-room button is visible.
export async function registerViaUi(page: Page, login: string): Promise<void> {
  await page.goto('/register');
  const dialog = authDialog(page, 'Создать аккаунт');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Логин').fill(login);
  await dialog.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Повторите пароль').fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/' && url.search === ''),
    dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  ]);
  // Lobby create button confirms we landed authenticated.
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });
}

// Log in through the UI for a second browser context that should share an
// existing account.
export async function loginViaUi(page: Page, login: string): Promise<void> {
  await page.goto('/login');
  const dialog = authDialog(page, 'Вход');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Логин').fill(login);
  await dialog.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/' && url.search === ''),
    dialog.getByRole('button', { name: 'Войти', exact: true }).click()
  ]);
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });
}

// Create a permanent ("Постоянная") room from the lobby via the create dialog.
// Creation now enters the room immediately, so return to the lobby before
// handing control back to callers that assert against the room card.
export async function createPermanentRoom(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая комната' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Постоянная' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByPlaceholder('Название комнаты').fill(name);
  const [createdResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST'
    ),
    dialog.getByRole('button', { name: 'Создать комнату' }).click()
  ]);
  const created = (await createdResponse.json()) as { roomId?: string; error?: string };
  expect(createdResponse.ok(), created.error || `Room creation failed with ${createdResponse.status()}`).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });
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
  await expect(roomHeading(page)).toBeVisible({ timeout: 20_000 });
}

export function roomHeading(page: Page) {
  return page.locator('.room-heading-title');
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
  return page.getByRole('menuitem', { name: 'Настройки комнаты', exact: true });
}

export async function openRoomSettings(page: Page): Promise<void> {
  await openRoomHeadingMenu(page);
  const button = roomSettingsButton(page);
  await expect(button).toBeVisible();
  await button.click();
}

export function settingsDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Настройки комнаты' });
}
