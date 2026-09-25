import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, createPermanentRoom, registerViaUi, uniqueLogin } from './helpers';

// A covered control fails fast with a named locator instead of hanging the test.
test.use({ actionTimeout: 15_000 });

const PIXEL_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';

async function phone(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    userAgent: PIXEL_UA,
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true
  });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      configurable: true,
      get: () => ({ mobile: true, platform: 'Android' })
    });
  });
  return context;
}

async function expectJoinedPhoneRoom(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-platform-class', 'mobile');
  await expect(page.getByRole('main', { name: 'Неподдерживаемое устройство' })).toHaveCount(0);
  await expect(page.locator('.status-pill[data-state="connected"]')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole('note')).toHaveText('Звонок идёт, пока браузер открыт и экран включён');
  await expect(page.locator('.screen-button')).toBeHidden();

  // Names what sticks out when it fails, so a regression points at its element.
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > width + 0.5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${String(element.className).split(' ').filter(Boolean).slice(0, 2).join('.')}`
      )
      .slice(0, 8);
    return { extra: document.documentElement.scrollWidth - width, offenders };
  });
  expect(
    overflow.extra,
    `no horizontal scroll; wider than the screen: ${overflow.offenders.join(', ')}`
  ).toBeLessThanOrEqual(0);
  for (const selector of ['.mic-button', '.output-button', '.leave-button']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.width, `${selector} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${selector} height`).toBeGreaterThanOrEqual(44);
  }
}

test('a guest on a phone joins a room, chats, and stays on the room page after leaving', async ({
  browser,
  page,
  baseURL
}) => {
  // Two accounts, a room, a phone join, chat and leave: longer than the default.
  test.setTimeout(120_000);
  await registerViaUi(page, uniqueLogin('mobilehost'));
  const roomId = await createPermanentRoom(page, `Mobile ${uniqueLogin('room')}`);

  const context = await phone(browser, baseURL);
  try {
    const guest = await context.newPage();
    await test.step('guest joins from the phone', async () => {
      await guest.goto(`/r/${roomId}`);
      await expect(guest.locator('#guestNameInput')).toBeVisible({ timeout: 20_000 });
      await guest.locator('#guestNameInput').fill('Телефон');
      await guest.locator('#guestNameSubmitButton').click();
      await expectJoinedPhoneRoom(guest);
      await expect(guest.getByRole('complementary', { name: 'Создать аккаунт' })).toBeVisible();
      await expect(guest.getByRole('complementary', { name: 'Скачать приложение' })).toHaveCount(0);
    });

    await test.step('guest chats from the phone', async () => {
      await guest.getByRole('button', { name: 'Чат', exact: true }).first().click();
      const composer = guest.getByPlaceholder('Написать в комнату…');
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.fill('привет с телефона');
      await composer.press('Enter');
      await expect(guest.getByText('привет с телефона').last()).toBeVisible({ timeout: 15_000 });
      // Paged history is account-only and answered a guest with 401 «Room is not
      // available», which the panel rendered as a chat error.
      await expect(guest.locator('.chat-rail-error')).toHaveCount(0);
      // On a narrow screen the chat covers the heading; it closes from its own header.
      await guest.getByRole('button', { name: 'Закрыть панель' }).click();
      await expect(composer).toBeHidden();
    });

    await guest.getByRole('button', { name: 'Покинуть звонок' }).click();
    const left = guest.getByRole('dialog', { name: 'Вы вышли из комнаты' });
    await expect(left).toBeVisible();
    await expect(left.getByRole('button', { name: 'Вернуться в звонок' })).toBeVisible();
    await expect(guest).toHaveURL(new RegExp(`/r/${roomId}$`));
  } finally {
    await context.close();
  }
});

test('a signed-in phone gets the standalone room with its account, never the lobby', async ({
  browser,
  page,
  baseURL
}) => {
  await registerViaUi(page, uniqueLogin('mobilehost'));
  const roomId = await createPermanentRoom(page, `Mobile ${uniqueLogin('room')}`);

  const context = await phone(browser, baseURL);
  try {
    const login = uniqueLogin('mobileuser');
    const registered = await context.request.post('/api/auth/register', {
      data: { login, password: PASSWORD, passwordConfirm: PASSWORD }
    });
    expect(registered.ok()).toBe(true);

    const member = await context.newPage();
    await member.goto(`/r/${roomId}`);
    await expectJoinedPhoneRoom(member);
    await expect(member.locator('#guestNameInput')).toBeHidden();
    await expect(member.locator('.lv-card')).toHaveCount(0);
    await expect(member.getByRole('complementary', { name: 'Создать аккаунт' })).toHaveCount(0);

    await member.getByRole('button', { name: 'Покинуть звонок' }).click();
    const left = member.getByRole('dialog', { name: 'Вы вышли из комнаты' });
    await expect(left).toContainText('Лобби, друзья и личные сообщения — на компьютере');
    await expect(member).toHaveURL(new RegExp(`/r/${roomId}$`));
  } finally {
    await context.close();
  }
});

test('a phone starts a temporary room from `/` and joins it as a guest', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const context = await phone(browser, baseURL);
  try {
    const visitor = await context.newPage();
    await visitor.goto('/');
    // `/` used to be desktop-only, so a phone had no way into a call of its own.
    await expect(visitor.getByRole('main', { name: 'Неподдерживаемое устройство' })).toHaveCount(0);
    await expect(visitor.getByRole('heading', { name: 'Голосовая комната прямо в браузере' })).toBeVisible();

    await visitor.getByRole('button', { name: 'Создать комнату' }).click();
    await expect(visitor).toHaveURL(/\/r\/[a-z0-9]+$/i, { timeout: 20_000 });

    await expect(visitor.locator('#guestNameInput')).toBeVisible({ timeout: 20_000 });
    await visitor.locator('#guestNameInput').fill('Телефон');
    await visitor.locator('#guestNameSubmitButton').click();
    await expectJoinedPhoneRoom(visitor);
  } finally {
    await context.close();
  }
});
