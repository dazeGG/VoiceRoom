import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, createPermanentRoom, registerViaUi, uniqueLogin } from './helpers';

async function joinAsGuest(browser: Browser, baseURL: string | undefined, roomId: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto(`/r/${roomId}`);
  // A fresh browser has no saved name, so the room always asks for one first.
  const nameInput = page.locator('#guestNameInput');
  await expect(nameInput).toBeVisible({ timeout: 20_000 });
  await nameInput.fill('Гость e2e');
  await page.locator('#guestNameSubmitButton').click();
  // The standalone room keeps the connection pill in the dock popover, so the
  // joined state is read from the pill's presence rather than its visibility.
  await expect(page.locator('.status-pill[data-state="connected"]')).toBeAttached({ timeout: 30_000 });
  return page;
}

async function fillRegistration(page: Page, login: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Создать аккаунт' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Логин').fill(login);
  await dialog.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Повторите пароль').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
}

test('a guest creates an account from the room and is back in the same call as that account', async ({ browser, page, baseURL }) => {
  await registerViaUi(page, uniqueLogin('ctahost'));
  const roomName = `CTA ${uniqueLogin('room')}`;
  const roomId = await createPermanentRoom(page, roomName);

  const guest = await joinAsGuest(browser, baseURL, roomId);
  try {
    const call = guest.getByRole('complementary', { name: 'Создать аккаунт' });
    await expect(call).toContainText('сохранить комнату');
    await call.getByRole('button', { name: 'Создать аккаунт' }).click();

    const login = uniqueLogin('ctaguest');
    const reloaded = guest.waitForEvent('load');
    await fillRegistration(guest, login);
    await reloaded;

    await expect(guest).toHaveURL(new RegExp(`/r/${roomId}$`));
    await expect(guest.locator('.status-pill[data-state="connected"]')).toBeAttached({ timeout: 30_000 });
    await expect(guest.getByRole('button', { name: 'Открыть снова' })).toHaveCount(0);
    await expect(guest.getByRole('complementary', { name: 'Создать аккаунт' })).toHaveCount(0);

    const me = await (await guest.context().request.get('/api/auth/me')).json() as { user: { login: string } | null };
    expect(me.user?.login).toBe(login);
    const rooms = await (await guest.context().request.get('/api/auth/rooms')).json() as { rooms?: Array<{ roomId: string }> };
    expect(rooms.rooms?.some((room) => room.roomId === roomId)).toBe(true);
  } finally {
    await guest.context().close();
  }
});

test('a guest leaving a permanent room is offered an account that keeps the room', async ({ browser, page, baseURL }) => {
  await registerViaUi(page, uniqueLogin('leavehost'));
  const roomName = `Leave ${uniqueLogin('room')}`;
  const roomId = await createPermanentRoom(page, roomName);

  const guest = await joinAsGuest(browser, baseURL, roomId);
  try {
    await guest.getByRole('button', { name: 'Покинуть звонок' }).click();
    const screen = guest.getByRole('dialog', { name: 'Вы вышли из комнаты' });
    await expect(screen).toContainText('вернётесь сюда без ссылки');
    await screen.getByRole('button', { name: 'Создать аккаунт' }).click();

    const login = uniqueLogin('leaveguest');
    await Promise.all([
      guest.waitForURL((url) => url.pathname === '/'),
      fillRegistration(guest, login)
    ]);
    await expect(guest.locator('.lv-card', { hasText: roomName }).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await guest.context().close();
  }
});
