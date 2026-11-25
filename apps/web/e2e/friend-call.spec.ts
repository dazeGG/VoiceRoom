import { expect, test, type Page } from '@playwright/test';
import { incomingFriendRequestIds, registerViaUi, uniqueLogin } from './helpers';

async function befriend(caller: Page, recipient: Page) {
  const callerName = uniqueLogin('callhost');
  const recipientName = uniqueLogin('callfriend');
  await registerViaUi(caller, callerName);
  await registerViaUi(recipient, recipientName);
  const request = await caller.context().request.post('/api/friends/requests', { data: { login: recipientName } });
  expect(request.ok()).toBe(true);
  const [requestId] = await incomingFriendRequestIds(recipient);
  expect(requestId).toBeTruthy();
  const accepted = await recipient.context().request.post(`/api/friends/requests/${requestId}/accept`, { data: {} });
  expect(accepted.ok()).toBe(true);
  await Promise.all([caller.goto('/app'), recipient.goto('/app')]);
  return { callerName, recipientName };
}

const friend = (page: Page, name: string) => page.locator('.sidebar__row', { hasText: name });
const dm = (page: Page) => page.getByRole('region', { name: 'Личные сообщения' });
const stage = (page: Page, name: string) => page.getByRole('region', { name: `Звонок: ${name}` });
const controls = (page: Page) => page.getByRole('group', { name: 'Управление звонком' });

test('friends answer a DM call, return from the rail, and see the completed call in both threads', async ({
  browser,
  page,
  baseURL
}) => {
  const context = await browser.newContext({ ...(baseURL && { baseURL }), locale: 'ru-RU' });
  try {
    const recipient = await context.newPage();
    const { callerName, recipientName } = await befriend(page, recipient);
    await friend(page, recipientName).click();
    await dm(page).getByRole('button', { name: 'Позвонить', exact: true }).click();
    await recipient
      .getByRole('region', { name: `${callerName} звонит вам` })
      .getByRole('button', { name: 'Принять', exact: true })
      .click();
    await expect(stage(page, recipientName).getByRole('timer')).toContainText('Звонок ·', { timeout: 20_000 });
    await expect(stage(recipient, callerName).getByRole('timer')).toContainText('Звонок ·', { timeout: 20_000 });

    await stage(page, recipientName).getByRole('button', { name: 'Открыть личные сообщения' }).click();
    const live = dm(page).getByRole('article');
    await expect(live).toContainText('Вы в звонке');
    await expect(live.getByRole('button', { name: 'Вернуться в звонок' })).toBeVisible();
    const rail = page.getByRole('region', { name: 'Активный звонок' });
    await rail.getByRole('button', { name: 'Вернуться в звонок' }).click();
    await expect(stage(page, recipientName)).toBeVisible();
    await controls(page).getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(stage(recipient, callerName).getByRole('button', { name: 'Позвонить снова' })).toBeVisible();
    await controls(recipient).getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(dm(page).getByRole('article')).toContainText('Исходящий звонок');
    await expect(dm(recipient).getByRole('article')).toContainText('Входящий звонок');
  } finally {
    await context.close();
  }
});

test('an expired attempt shows one missed call while the caller can still wait', async ({ browser, page, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...(baseURL && { baseURL }), locale: 'ru-RU' });
  try {
    const recipient = await context.newPage();
    const { callerName, recipientName } = await befriend(page, recipient);
    await friend(page, recipientName).click();
    await dm(page).getByRole('button', { name: 'Позвонить', exact: true }).click();
    const card = recipient.getByRole('region', { name: `${callerName} звонит вам` });
    await expect(card).toBeVisible();
    const missedBadge = friend(recipient, callerName).getByRole('img', { name: '1 пропущенный звонок' });
    await expect(missedBadge).toBeVisible({ timeout: 55_000 });
    await expect(card).toBeHidden();
    await expect(stage(page, recipientName).getByRole('button', { name: 'Позвонить снова' })).toBeVisible();

    await friend(recipient, callerName).click();
    const missed = dm(recipient).getByRole('article');
    await expect(missed).toContainText('Пропущенный звонок');
    await expect(missedBadge).toBeHidden();
    await controls(page).getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(dm(page).getByRole('article')).toContainText('Нет ответа');
    await expect(missed.getByRole('button', { name: 'Перезвонить' })).toBeVisible();
  } finally {
    await context.close();
  }
});
