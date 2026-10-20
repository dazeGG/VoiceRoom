import { expect, test } from '@playwright/test';
import type { MemberPage } from '@voice-room/shared/contracts/membership';
import {
  MessageContent,
  PostRoomMessageBody,
  type ReactionSet,
  type ReactionSummaries,
  type RoomMessageAnswer
} from '@voice-room/shared/contracts/messages';
import type { InboxPage } from '@voice-room/shared/contracts/notifications';
import { parse } from '../test/helpers/assert';
import {
  boxOf,
  createPermanentRoom,
  enableCapabilities,
  enterRoom,
  incomingFriendRequestIds,
  registerViaUi,
  uniqueLogin
} from './helpers';

test('manual polish renders the inbox between download/settings and opens it locally', async ({ page }) => {
  await enableCapabilities(page, ['engagement']);
  const inbox: InboxPage = {
    contractVersion: 1,
    notifications: [],
    pageInfo: { hasMore: false },
    unreadCount: 0,
    revision: 0,
    firstUnread: null
  };
  await page.route('**/api/notifications/inbox*', (route) => route.fulfill({ json: inbox }));
  await registerViaUi(page, uniqueLogin('inboxplacement'));

  const download = page.getByRole('button', { name: 'Скачать приложение' });
  const notifications = page.getByRole('button', { name: 'Открыть уведомления' });
  const settings = page.getByRole('button', { name: 'Открыть настройки' });
  await expect(download).toBeVisible();
  await expect(notifications).toBeVisible();
  await expect(settings).toBeVisible();
  const [downloadBox, notificationBox, settingsBox] = await Promise.all([
    boxOf(download),
    boxOf(notifications),
    boxOf(settings)
  ]);
  expect(downloadBox.x).toBeLessThan(notificationBox.x);
  expect(notificationBox.x).toBeLessThan(settingsBox.x);

  await notifications.click();
  await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
  await expect(notifications).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toHaveCount(0);
});

test('manual polish renders direct messages with the shared flat chat row and arrow reply action', async ({
  browser,
  page,
  baseURL
}) => {
  await enableCapabilities(page, ['replies']);
  const firstLogin = uniqueLogin('dmflatone');
  const secondLogin = uniqueLogin('dmflattwo');
  await registerViaUi(page, firstLogin);
  const secondContext = await browser.newContext(baseURL ? { baseURL } : {});
  const second = await secondContext.newPage();
  try {
    await registerViaUi(second, secondLogin);
    const request = await secondContext.request.post('/api/friends/requests', { data: { login: firstLogin } });
    expect(request.ok()).toBe(true);
    const [requestId] = await incomingFriendRequestIds(page);
    expect(requestId).toBeTruthy();
    const accepted = await page.context().request.post(`/api/friends/requests/${requestId}/accept`, { data: {} });
    expect(accepted.ok()).toBe(true);

    await page.reload();
    await page.locator('.lv-row', { hasText: secondLogin }).first().click();
    const composer = page.getByPlaceholder('Написать сообщение…');
    await expect(composer).toBeVisible();
    await composer.fill('flat direct message');
    await composer.press('Enter');
    // Anchor on the row id: the composer preview repeats the message text once a
    // reply target is picked, and the text leaves the row entirely in edit mode,
    // so a text lookup would drift away from the row under test.
    const sentMessage = page.locator('.dm-chat-message', { hasText: 'flat direct message' }).last();
    await expect(sentMessage).toBeVisible();
    const message = page.locator(
      `.dm-chat-message[data-message-id="${await sentMessage.getAttribute('data-message-id')}"]`
    );
    await expect(message).toBeVisible();
    await expect(message.locator('xpath=ancestor::div[contains(@class,"dm-chat-group")]')).toHaveAttribute(
      'data-self',
      'true'
    );
    const style = await message.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        background: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        marginLeft: computed.marginLeft
      };
    });
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.borderRadius).toBe('0px');
    expect(Number.parseFloat(style.marginLeft)).toBeLessThanOrEqual(0);

    await message.hover();
    const reply = message.getByRole('button', { name: 'Ответить' });
    const copy = message.getByRole('button', { name: 'Копировать текст' });
    const more = message.getByRole('button', { name: 'Больше действий' });
    await expect(reply).toBeVisible();
    await expect(copy).toBeVisible();
    await expect(more).toBeVisible();
    await expect(message.getByRole('button', { name: 'Редактировать' })).toHaveCount(0);
    await expect(message.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
    await expect(reply.locator('svg')).toHaveCount(1);
    await reply.click();
    const dmReplyTarget = page.locator('.reply-target');
    await expect(dmReplyTarget).toContainText('flat direct message');
    await expect(dmReplyTarget.getByRole('button', { name: 'Отменить ответ' })).toBeVisible();

    await message.hover();
    await more.click();
    const menu = page.getByRole('menu', { name: 'Действия с сообщением' });
    await expect(menu.getByRole('menuitem', { name: 'Изменить' })).toBeVisible();
    await page.keyboard.press('e');
    await expect(message.getByRole('textbox', { name: 'Текст сообщения' })).toBeVisible();
  } finally {
    await secondContext.close();
  }
});

test('the lobby preview runs the same room chat as the rail, with jumpable quotes and clickable identity', async ({
  page
}) => {
  await enableCapabilities(page, ['reactions', 'replies']);
  const login = uniqueLogin('chatparity');
  await registerViaUi(page, login);
  const roomName = `Parity ${login}`;
  const roomId = await createPermanentRoom(page, roomName);

  await page.locator('.lv-card', { hasText: roomName }).first().click();
  await page.getByRole('button', { name: 'Чат', exact: true }).first().click();
  const composer = page.getByPlaceholder('Написать в комнату…');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill('parity message');
  await composer.press('Enter');

  const row = page.locator('.chat-msg-text', { hasText: 'parity message' }).last();
  await expect(row).toBeVisible();

  // The preview owns the same hover toolbar as the room rail, reactions included.
  // Quick reactions live in the message menu, so the toolbar stays narrow enough
  // to clear the author line.
  await row.hover();
  await expect(row.getByRole('button', { name: 'Открыть выбор эмодзи' })).toBeVisible();
  await expect(row.getByRole('button', { name: /Добавить быструю реакцию/ })).toHaveCount(0);
  await row.getByRole('button', { name: 'Больше действий' }).click();
  const menu = page.getByRole('menu', { name: 'Действия с сообщением' });
  await expect(menu.getByRole('menuitem', { name: /Реакция/ })).toHaveCount(3);
  await expect(menu.getByRole('menuitem', { name: 'Поставить реакцию' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Answering shows an icon-cancelled row whose quote jumps back to the message.
  await row.getByRole('button', { name: 'Ответить' }).click();
  const replyTarget = page.locator('.reply-target');
  await expect(replyTarget).toBeVisible();
  await expect(replyTarget.getByRole('button', { name: 'Отменить ответ' })).toBeVisible();
  await expect(replyTarget.getByRole('button', { name: /Отмена$/ })).toHaveCount(0);
  await expect(replyTarget.getByRole('button', { name: /Перейти к сообщению/ })).toBeVisible();
  await replyTarget.getByRole('button', { name: 'Отменить ответ' }).click();
  await expect(replyTarget).toHaveCount(0);

  // Your own avatar and name open your own card instead of being inert text.
  const selfTriggers = page.getByRole('button', { name: 'Ваш профиль' });
  await expect(selfTriggers).toHaveCount(2);
  await selfTriggers.first().click();
  await expect(page.locator('[data-profile-card]')).toBeVisible();
  await page.keyboard.press('Escape');

  // The rail opens parked on the newest message.
  await enterRoom(page, roomId);
  const rail = page.locator('.room-chat-rail').first();
  if (await rail.evaluate((element) => element instanceof HTMLElement && element.hidden)) {
    await page.locator('button[title="Чат"]').first().click();
  }
  const railBody = page.locator('.room-chat-rail .chat-rail-body');
  await expect(railBody).toBeVisible({ timeout: 20_000 });
  await expect(railBody.locator('.chat-msg-text', { hasText: 'parity message' })).toBeVisible();
  await expect
    .poll(async () =>
      railBody.evaluate((element) => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))
    )
    .toBeLessThanOrEqual(2);
});

test('manual polish keeps the newest mention query, emits login-bound segments, and flips the picker at the viewport edge', async ({
  page
}) => {
  await enableCapabilities(page, ['engagement', 'reactions']);
  const login = uniqueLogin('mentionrace');
  await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, `Mention race ${login}`);

  const { promise: slowResponse, resolve: releaseSlow } = Promise.withResolvers<void>();
  const { promise: sawSlowRequest, resolve: slowRequested } = Promise.withResolvers<void>();
  await page.route(`**/api/rooms/${roomId}/members?*`, async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (!query) return route.fallback();
    if (query === 'slow') {
      slowRequested();
      await slowResponse;
    }
    const stable = query === 'stable';
    const json: MemberPage = {
      contractVersion: 1,
      roomId,
      members: [
        {
          userId: stable ? 'stable-user' : 'slow-user',
          displayName: stable ? 'Display Name That Must Not Become The Token' : 'Stale Result',
          login: stable ? 'stable_login' : 'slow_login',
          avatarColorKey: 'green',
          avatarUrl: null,
          avatarAccent: null,
          role: 'member',
          joinedAt: Date.now(),
          inVoice: false,
          presenceStatus: 'online'
        }
      ],
      pageInfo: { hasMore: false },
      presenceRevision: stable ? 2 : 1
    };
    await route.fulfill({ json });
  });
  await page.route('**/api/reactions/**', (route) => {
    if (route.request().method() === 'GET') {
      const json: ReactionSummaries = { ok: true, summaries: [] };
      return route.fulfill({ json });
    }
    const json: ReactionSet = { ok: true, summary: { emoji: '👍', count: 1, reactedByMe: true, revision: '1' } };
    return route.fulfill({ json });
  });
  let messageOrdinal = 0;
  await page.route(`**/api/rooms/${roomId}/chat`, async (route) => {
    const body = parse(PostRoomMessageBody, route.request().postDataJSON());
    messageOrdinal += 1;
    // Built as the route's contract answer: the web refuses any other shape.
    const answer = {
      ok: true,
      message: {
        id: `manual-polish-${messageOrdinal}`,
        roomId,
        peerId: 'manual-polish-peer',
        authorUserId: 'manual-polish-user',
        name: body.name || login,
        avatarAccent: null,
        avatarColorKey: 'green',
        avatarUrl: null,
        text: body.text ?? '',
        content: body.content === undefined ? null : parse(MessageContent, body.content),
        createdAt: Date.now() + messageOrdinal,
        editedAt: null,
        expiresAt: Date.now() + 60_000,
        attachments: []
      }
    } satisfies RoomMessageAnswer;
    await route.fulfill({ json: answer });
  });

  await enterRoom(page, roomId);
  await page.getByRole('button', { name: 'Чат', exact: true }).click();
  const composer = page.getByPlaceholder('Написать в комнату…');
  await composer.fill('@slow');
  await sawSlowRequest;
  await composer.fill('@stable');
  const stableOption = page.getByRole('option', { name: /@stable_login/ });
  await expect(stableOption).toBeVisible();
  releaseSlow();
  await expect(page.getByRole('option', { name: /@slow_login/ })).toHaveCount(0);
  await stableOption.click();
  await expect.poll(() => composer.evaluate((element) => element.textContent)).toBe('@stable_login ');
  const mentionRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(`/api/rooms/${roomId}/chat`)
  );
  await composer.press('Enter');
  const payload = parse(PostRoomMessageBody, (await mentionRequest).postDataJSON());
  expect(parse(MessageContent, payload.content).segments).toEqual([
    { type: 'mention', userId: 'stable-user', label: '@stable_login' }
  ]);

  for (let index = 0; index < 16; index += 1) {
    await composer.fill(`picker row ${index}`);
    await composer.press('Enter');
  }
  await page.setViewportSize({ width: 1000, height: 420 });
  const first = page.locator('.chat-msg-text', { hasText: 'picker row 0' });
  await first.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect.poll(async () => (await first.boundingBox())?.y ?? 1000).toBeLessThan(180);
  await first.hover();
  const pickerTrigger = first.getByRole('button', { name: 'Открыть выбор эмодзи' });
  await pickerTrigger.focus();
  await pickerTrigger.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Выбор реакции' });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('data-placement', 'bottom-start');
  const pickerBox = await boxOf(picker);
  expect(pickerBox.y).toBeGreaterThanOrEqual(8);
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(420);
  await expect.poll(() => picker.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  await expect
    .poll(() => page.locator('.chat-rail-body').evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});

test('room members panel releases navigation, switches to chat, collapses, and keeps speaking state binary', async ({
  browser,
  page,
  baseURL
}) => {
  await enableCapabilities(page, ['membership']);
  await page.setViewportSize({ width: 1440, height: 900 });

  const ownerLogin = uniqueLogin('roomnavowner');
  const friendLogin = uniqueLogin('roomnavfriend');
  await registerViaUi(page, ownerLogin);

  const friendContext = await browser.newContext(baseURL ? { baseURL } : {});
  const friendPage = await friendContext.newPage();
  try {
    await registerViaUi(friendPage, friendLogin);
    const request = await friendContext.request.post('/api/friends/requests', { data: { login: ownerLogin } });
    expect(request.ok()).toBe(true);
    const [requestId] = await incomingFriendRequestIds(page);
    expect(requestId).toBeTruthy();
    const accepted = await page.context().request.post(`/api/friends/requests/${requestId}/accept`, { data: {} });
    expect(accepted.ok()).toBe(true);

    await page.reload();
    const roomName = `Room navigation ${ownerLogin}`;
    const roomId = await createPermanentRoom(page, roomName);
    let membershipRequests = 0;
    await page.route(`**/api/rooms/${roomId}/members*`, async (route) => {
      membershipRequests += 1;
      const json: MemberPage = {
        contractVersion: 1,
        roomId,
        members: [
          {
            userId: 'room-navigation-owner',
            displayName: ownerLogin,
            login: ownerLogin,
            avatarColorKey: 'green',
            avatarUrl: null,
            avatarAccent: null,
            role: 'owner',
            joinedAt: Date.now(),
            inVoice: true,
            presenceStatus: 'online'
          }
        ],
        pageInfo: { hasMore: false },
        presenceRevision: 1
      };
      await route.fulfill({ json });
    });
    await enterRoom(page, roomId);

    const panel = page.locator('.room-chat-rail');
    const topbarTabs = page.locator('.room-heading-actions .room-panel-tabs');
    await topbarTabs.getByRole('button', { name: 'Участники' }).click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('#room-panel-participants')).toBeVisible();
    await expect(panel.getByText(ownerLogin, { exact: true }).first()).toBeVisible();
    const member = panel.getByRole('button', { name: `Профиль ${ownerLogin}` });
    await expect(member).toBeVisible();
    await member.click();
    await expect(page.getByRole('dialog', { name: `Профиль ${ownerLogin}` })).toBeVisible();
    await page.keyboard.press('Escape');

    const panelChatTab = panel.getByRole('tab', { name: 'Чат' });
    await expect
      .poll(() =>
        panelChatTab.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('button') ===
            element
          );
        })
      )
      .toBe(true);
    await panelChatTab.click();
    await expect(panel.locator('#room-panel-chat')).toBeVisible();
    await panel.getByRole('tab', { name: 'Участники' }).click();
    await expect(panel.locator('#room-panel-participants')).toBeVisible();
    expect(membershipRequests).toBeLessThanOrEqual(2);

    const localTile = page.locator('.participant[data-local="true"]').first();
    await expect(localTile).toBeVisible({ timeout: 20_000 });
    const speakingStyle = await localTile.evaluate((element) => {
      const tile = getComputedStyle(element);
      const voiceRing = element.querySelector('.voice-ring');
      if (!voiceRing) throw new Error('the tile has no voice ring');
      const ring = getComputedStyle(voiceRing);
      return {
        tileTransitionProperty: tile.transitionProperty,
        ringTransitionDuration: ring.transitionDuration,
        ringTransform: ring.transform
      };
    });
    expect(speakingStyle.tileTransitionProperty).not.toContain('border-color');
    expect(speakingStyle.tileTransitionProperty).not.toContain('box-shadow');
    expect(speakingStyle.ringTransitionDuration).toBe('0s');
    expect(speakingStyle.ringTransform).toBe('none');

    await page.locator('.lv-row', { hasText: friendLogin }).first().click();
    await expect(page.getByPlaceholder('Написать сообщение…')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-screen', 'start');

    await page.getByRole('button', { name: `Открыть комнату ${roomName}` }).click();
    await expect(page.locator('body')).toHaveAttribute('data-screen', 'room');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Свернуть панель' }).click();
    await expect(panel).toBeHidden();

    await topbarTabs.getByRole('button', { name: 'Чат' }).click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('#room-panel-chat')).toBeVisible();
    await panel.getByRole('button', { name: 'Свернуть панель' }).click();
    await expect(panel).toBeHidden();

    await topbarTabs.getByRole('button', { name: 'Участники' }).click();
    await expect(panel.locator('#room-panel-participants')).toBeVisible();
    await page.locator('.lv-side-head').click();
    await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-screen', 'start');
  } finally {
    await friendContext.close();
  }
});
