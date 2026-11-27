import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { Value } from 'typebox/value';
import { APP_HOME } from '@voiceroom/shared/app-home';
import { Failure } from '@voiceroom/shared/contracts/http';
import { Capabilities } from '@voiceroom/shared/contracts/ops';
import { RoomCreated } from '@voiceroom/shared/contracts/rooms';
import { FriendList, FriendRequests } from '@voiceroom/shared/contracts/social';
import { WHATS_NEW_RELEASE } from '../src/shared/whats-new-release';
import { defined, parse } from '../test/helpers/assert';

/** The element's box; fails when the locator's element is not rendered. */
export async function boxOf(locator: Locator) {
  return defined(await locator.boundingBox(), 'bounding box');
}

/** Turns the named features on in the capabilities the page reads. */
export async function enableCapabilities(page: Page, enabled: string[]): Promise<void> {
  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const body = parse(Capabilities, await response.json());
    const json: Capabilities = {
      ...body,
      features: { ...body.features, ...Object.fromEntries(enabled.map((key) => [key, true])) }
    };
    await route.fulfill({ response, json });
  });
}

/** Ids of the friend requests the page's account has received. */
export async function incomingFriendRequestIds(page: Page): Promise<string[]> {
  const response = await page.context().request.get('/api/friends/requests');
  expect(response.ok()).toBe(true);
  return parse(FriendRequests, await response.json()).incoming.map((request) => request.id);
}

/** Opens a friend's thread even before the first message or call. */
export async function openFriendChat(page: Page, login: string): Promise<void> {
  const sidebar = page.locator('#lobby-sidebar');
  await sidebar.getByRole('button', { name: /^Друзья/ }).click();
  const friends = page.getByRole('region', { name: 'Друзья', exact: true });
  const row = friends.getByRole('listitem').filter({ hasText: `@${login}` });
  await row.hover();
  await row.getByRole('button', { name: 'Написать', exact: true }).click();
}

export function chatRow(page: Page, name: string): Locator {
  return page.getByRole('region', { name: 'Чаты', exact: true }).getByRole('button', { name, exact: true });
}

/** Creates conversation activity for a test that starts on the chats list. */
export async function seedFriendChat(page: Page, login: string): Promise<void> {
  const request = page.context().request;
  const response = await request.get('/api/friends');
  expect(response.ok()).toBe(true);
  const { friends } = parse(FriendList, await response.json());
  const peer = defined(
    friends.find(({ user }) => user.login === login),
    `friend ${login}`
  );
  expect((await request.post(`/api/dm/${peer.user.id}`, { data: { text: 'Hello' } })).ok()).toBe(true);
}

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
  return `${prefix}${stamp}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
}

export const PASSWORD = 'e2e-password-123';

// Register a fresh account straight through the API. Web registration also
// acknowledges the current "what's new" announcement, so do the same here;
// otherwise its dialog covers the lobby.
export async function registerViaApi(request: APIRequestContext, login: string): Promise<void> {
  const registered = await request.post('/api/auth/register', {
    data: { login, password: PASSWORD, passwordConfirm: PASSWORD }
  });
  expect(registered.ok(), `Registration failed with HTTP ${registered.status()}`).toBe(true);
  const seen = await request.post('/api/auth/whats-new/seen', { data: { release: WHATS_NEW_RELEASE } });
  expect(seen.ok(), `What's new acknowledgement failed with HTTP ${seen.status()}`).toBe(true);
}

function authDialog(page: Page, name: 'Вход' | 'Создать аккаунт') {
  return page.getByRole('dialog', { name });
}

// Register a fresh account through the UI. On success the app redirects to
// the lobby ("/app"), where the create-room button is visible.
export async function registerViaUi(page: Page, login: string): Promise<void> {
  await page.goto('/register');
  const dialog = authDialog(page, 'Создать аккаунт');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Логин').fill(login);
  await dialog.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Повторите пароль').fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/app' && url.search === ''),
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
    page.waitForURL((url) => url.pathname === '/app' && url.search === ''),
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
    page.waitForResponse((response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST'),
    dialog.getByRole('button', { name: 'Создать комнату' }).click()
  ]);
  const answer: unknown = await createdResponse.json();
  const failure = Value.Check(Failure, answer) ? answer.error : '';
  expect(createdResponse.ok(), failure || `Room creation failed with ${createdResponse.status()}`).toBe(true);
  const created = parse(RoomCreated, answer);
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible({ timeout: 15_000 });
  const card = page.locator('.voice-home__card', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const roomId = created.roomId.trim();
  expect(roomId).toMatch(/^[a-z0-9]+$/i);
  return roomId;
}

// Navigate directly to a room and wait for the in-room topbar heading to
// render (body.screen--room). Authenticated users skip the guest
// name prompt, so the room screen appears automatically.
export async function enterRoom(page: Page, roomId: string): Promise<void> {
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('body')).toHaveClass(/\bscreen--room\b/, { timeout: 20_000 });
  await expect(roomHeading(page)).toBeVisible({ timeout: 20_000 });
}

export function roomHeading(page: Page) {
  return page.locator('.room-topbar__heading-title');
}

export function roomHeadingMenuButton(page: Page) {
  return page.locator('.room-topbar__heading-trigger');
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

export async function deleteRoomViaSettings(page: Page, roomName: string): Promise<void> {
  await openRoomSettings(page);
  await settingsDialog(page).getByRole('button', { name: 'Удалить комнату', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: `Удалить комнату «${roomName}»?` });
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.waitForURL((url) => url.pathname === APP_HOME, { waitUntil: 'commit', timeout: 15_000 });
}
