import { expect, test } from '@playwright/test';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

test('a friend sees typing and emoji browsing under the message field, until the message arrives', async ({ browser, page, baseURL }) => {
  const readerLogin = uniqueLogin('typingreader');
  const writerLogin = uniqueLogin('typingwriter');
  await registerViaUi(page, readerLogin);
  const writerContext = await browser.newContext({ baseURL });
  const writer = await writerContext.newPage();
  try {
    await registerViaUi(writer, writerLogin);
    const request = await writerContext.request.post('/api/friends/requests', { data: { login: readerLogin } });
    expect(request.ok()).toBe(true);
    const incoming = await page.context().request.get('/api/friends/requests');
    const requestId = ((await incoming.json()) as { incoming?: Array<{ id: string }> }).incoming?.[0]?.id;
    expect(requestId).toBeTruthy();
    expect((await page.context().request.post(`/api/friends/requests/${requestId}/accept`, { data: {} })).ok()).toBe(true);

    await page.goto('/');
    await page.locator('.lv-row', { hasText: writerLogin }).first().click();
    const typing = page.locator('.lobby-dm-compose .chat-typing');
    await expect(page.locator('.lobby-dm-head-status')).toBeVisible();
    await expect(typing).toHaveText('');

    await writer.goto('/');
    await writer.locator('.lv-row', { hasText: readerLogin }).first().click();
    const composer = writer.getByPlaceholder('Написать сообщение…');
    await composer.fill('секунду, пишу');
    await expect(typing).toHaveText(/ печатает…$/);
    await expect(page.locator('.lobby-dm-head-status')).not.toContainText('печатает');

    await writer.getByRole('button', { name: 'Добавить эмодзи' }).click();
    await expect(typing).toHaveText(/ выбирает эмодзи…$/);
    await writer.getByRole('gridcell', { name: 'Эмодзи 👍' }).first().click();
    await expect(composer).toHaveValue('секунду, пишу👍');
    await expect(composer).toBeFocused();
    await expect(typing).toHaveText(/ печатает…$/);

    await composer.press('Enter');
    await expect(page.locator('.dm-chat-message', { hasText: 'секунду, пишу👍' }).last()).toBeVisible();
    await expect(typing).toHaveText('');
  } finally {
    await writerContext.close();
  }
});

test('the room chat shows who is typing from the call to someone reading it in the lobby', async ({ browser, page, baseURL }) => {
  const ownerLogin = uniqueLogin('typingowner');
  const guestLogin = uniqueLogin('typingcaller');
  await registerViaUi(page, ownerLogin);
  const roomName = `Typing ${ownerLogin}`;
  const roomId = await createPermanentRoom(page, roomName);
  await page.locator('.lv-card', { hasText: roomName }).first().click();
  await page.getByRole('button', { name: 'Чат', exact: true }).first().click();
  await expect(page.getByPlaceholder('Написать в комнату…')).toBeVisible({ timeout: 20_000 });

  const callerContext = await browser.newContext({ baseURL });
  const caller = await callerContext.newPage();
  try {
    await registerViaUi(caller, guestLogin);
    await enterRoom(caller, roomId);
    const rail = caller.locator('.room-chat-rail').first();
    if (await rail.evaluate((element) => (element as HTMLElement).hidden)) {
      await caller.locator('button[title="Чат"]').first().click();
    }
    const composer = caller.locator('.room-chat-rail').getByPlaceholder('Написать в комнату…');
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill('сейчас расскажу');

    const typing = page.locator('.chat-rail-compose .chat-typing');
    await expect(typing).toHaveText(`${guestLogin} печатает…`);
    await expect(caller.locator('.chat-rail-compose .chat-typing')).toHaveText('');

    await caller.locator('.room-chat-rail').getByRole('button', { name: 'Добавить эмодзи' }).click();
    await expect(typing).toHaveText(`${guestLogin} выбирает эмодзи…`);
    await caller.keyboard.press('Escape');

    await composer.press('Enter');
    await expect(page.locator('.chat-msg-text', { hasText: 'сейчас расскажу' }).last()).toBeVisible();
    await expect(typing).toHaveText('');
  } finally {
    await callerContext.close();
  }
});
