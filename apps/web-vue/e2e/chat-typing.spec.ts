import { expect, test } from '@playwright/test';
import { createPermanentRoom, enterRoom, incomingFriendRequestIds, registerViaUi, uniqueLogin } from './helpers';

test('a friend sees typing and emoji browsing under the message field, until the message arrives', async ({
  browser,
  page,
  baseURL
}) => {
  const readerLogin = uniqueLogin('typingreader');
  const writerLogin = uniqueLogin('typingwriter');
  await registerViaUi(page, readerLogin);
  const writerContext = await browser.newContext(baseURL ? { baseURL } : {});
  const writer = await writerContext.newPage();
  try {
    await registerViaUi(writer, writerLogin);
    const request = await writerContext.request.post('/api/friends/requests', { data: { login: readerLogin } });
    expect(request.ok()).toBe(true);
    const [requestId] = await incomingFriendRequestIds(page);
    expect(requestId).toBeTruthy();
    expect((await page.context().request.post(`/api/friends/requests/${requestId}/accept`, { data: {} })).ok()).toBe(
      true
    );

    await page.goto('/');
    await page.locator('.sidebar__row', { hasText: writerLogin }).first().click();
    const typing = page.locator('.dm-composer .typing-indicator');
    await expect(page.locator('.dm-view__head-status')).toBeVisible();
    await expect(typing).toHaveText('');

    await writer.goto('/');
    await writer.locator('.sidebar__row', { hasText: readerLogin }).first().click();
    const composer = writer.getByPlaceholder('Написать сообщение…');
    await composer.fill('секунду, пишу');
    await expect(typing).toHaveText(/ печатает…$/);
    await expect(page.locator('.dm-view__head-status')).not.toContainText('печатает');

    await writer.getByRole('button', { name: 'Добавить эмодзи' }).click();
    await expect(typing).toHaveText(/ выбирает эмодзи…$/);
    await writer.getByRole('gridcell', { name: 'Эмодзи 👍' }).first().click();
    // The field draws the emoji as artwork, so the text is the words and the
    // emoji is an image carrying the character.
    await expect(composer).toHaveText('секунду, пишу');
    await expect(composer.locator('img.emoji-composer__emoji[alt="👍"]')).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(typing).toHaveText(/ печатает…$/);

    await composer.press('Enter');
    // The message draws 👍 as artwork, so its text is the words and the emoji
    // is an image carrying the character.
    const sent = page.locator('.message-bubble--dm', { hasText: 'секунду, пишу' }).last();
    await expect(sent).toBeVisible();
    await expect(sent.locator('img[alt="👍"]')).toBeVisible();
    await expect(typing).toHaveText('');
  } finally {
    await writerContext.close();
  }
});

test('the room chat shows who is typing from the call to someone reading it in the lobby', async ({
  browser,
  page,
  baseURL
}) => {
  const ownerLogin = uniqueLogin('typingowner');
  const guestLogin = uniqueLogin('typingcaller');
  await registerViaUi(page, ownerLogin);
  const roomName = `Typing ${ownerLogin}`;
  const roomId = await createPermanentRoom(page, roomName);
  await page.locator('.voice-home__card', { hasText: roomName }).first().click();
  await page.getByRole('button', { name: 'Чат', exact: true }).first().click();
  await expect(page.getByPlaceholder('Написать в комнату…')).toBeVisible({ timeout: 20_000 });

  const callerContext = await browser.newContext(baseURL ? { baseURL } : {});
  const caller = await callerContext.newPage();
  try {
    await registerViaUi(caller, guestLogin);
    await enterRoom(caller, roomId);
    const rail = caller.locator('.room-chat-rail').first();
    if (await rail.evaluate((element) => element instanceof HTMLElement && element.hidden)) {
      await caller.locator('button[title="Чат"]').first().click();
    }
    const composer = caller.locator('.room-chat-rail').getByPlaceholder('Написать в комнату…');
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill('сейчас расскажу');

    const typing = page.locator('.room-chat-composer .typing-indicator');
    await expect(typing).toHaveText(`${guestLogin} печатает…`);
    await expect(caller.locator('.room-chat-composer .typing-indicator')).toHaveText('');

    await caller.locator('.room-chat-rail').getByRole('button', { name: 'Добавить эмодзи' }).click();
    await expect(typing).toHaveText(`${guestLogin} выбирает эмодзи…`);
    await caller.keyboard.press('Escape');

    await composer.press('Enter');
    await expect(page.locator('.message-bubble', { hasText: 'сейчас расскажу' }).last()).toBeVisible();
    await expect(typing).toHaveText('');
  } finally {
    await callerContext.close();
  }
});
