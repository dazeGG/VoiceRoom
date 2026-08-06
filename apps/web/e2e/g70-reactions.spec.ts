import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

const store = readFileSync(new URL('../src/lib/shared/chat/reaction-store.svelte.ts', import.meta.url), 'utf8');
const summary = readFileSync(new URL('../src/lib/shared/chat/ReactionSummary.svelte', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../src/lib/shared/chat/ReactionPicker.svelte', import.meta.url), 'utf8');
const reactors = readFileSync(new URL('../src/lib/shared/chat/ReactorList.svelte', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/lib/features/room/components/RoomChat.svelte', import.meta.url), 'utf8');
const dm = readFileSync(new URL('../src/lib/features/home/components/lobby/DmView.svelte', import.meta.url), 'utf8');

test('G70 supplemental source contracts cover reconciliation branches', async () => {
  expect(store).toContain('Math.max(0');
  expect(store).toMatch(/revision\(summary\.revision\) < revision\(current\.revision\)/);
  expect(store).toContain('this.applyServer(messageId, authoritative)');
  expect(store).toContain('new Map(candidates.map((reactor) => [reactor.userId, reactor]))');
  expect(store).toContain('this.reactorRequests[key] !== requestId');
  expect(store).toContain('this.isDeleted(messageId)');
  expect(room).toContain('reactions.markDeleted(mid)');
  expect(dm).toContain('reactions.markDeleted(mid)');
  expect(room).toContain("event.type === 'reaction.updated'");
  expect(dm).toContain("event.type !== 'reaction.updated'");
});

test('G70 supplemental accessibility contracts remain visible in components', async () => {
  expect(room).toContain('reactionsEnabled && session.user?.id');
  expect(room).toContain('canMutate={Boolean(session.user?.id)}');
  expect(summary).toContain('{#if canMutate}');
  expect(summary).toContain('aria-pressed={summary.reactedByMe}');
  expect(summary).toContain('aria-haspopup="dialog"');
  expect(summary).toContain('role="alert"');
  expect(picker).toMatch(/ArrowRight|ArrowLeft/);
  expect(picker).toMatch(/ArrowDown|ArrowUp/);
  expect(picker).toMatch(/Home|End/);
  expect(picker).toContain('role="grid"');
  expect(reactors).toContain('heading?.focus()');
  expect(reactors).toContain('aria-live="polite"');
  expect(reactors).toContain('Показать ещё');
});

test('G70 supplemental mocked keyboard and pagination rendering remains deterministic', async ({ page }) => {
  const allReactors = Array.from({ length: 120 }, (_, index) => ({ userId: `user-${index}`, displayName: `Reactor ${index}`, avatarUrl: null }));
  await page.route('**/api/capabilities', async (route) => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, features: { ...body.features, reactions: true } } }); });
  await page.route('**/api/reactions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/reactors')) { const offset = Number(url.searchParams.get('cursor') || 0); const reactors = allReactors.slice(offset, offset + 50); return route.fulfill({ json: { ok: true, reactors, nextCursor: offset + reactors.length < allReactors.length ? String(offset + reactors.length) : null } }); }
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, summaries: [{ emoji: '👍', count: 120, reactedByMe: false, revision: '1' }] } });
    const requested = route.request().postDataJSON() as { emoji?: string };
    return route.fulfill({ json: { ok: true, summary: { emoji: requested.emoji || '👍', count: 120, reactedByMe: true, revision: '1' } } });
  });
  const login = uniqueLogin('reactionkbd'); await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, `Reaction keyboard ${login}`); await enterRoom(page, roomId);
  await page.getByRole('button', { name: 'Чат', exact: true }).click();
  const input = page.getByPlaceholder('Написать в комнату…'); await input.fill('keyboard reaction'); await input.press('Enter');
  const message = page.locator('.chat-msg-text', { hasText: 'keyboard reaction' }); await expect(message).toBeVisible(); await message.hover();
  const pickerButton = message.getByRole('button', { name: 'Открыть выбор эмодзи' }); await pickerButton.focus(); await pickerButton.press('Enter');
  const grid = page.getByRole('grid', { name: 'Доступные реакции' }); await expect(grid).toBeVisible(); const search = page.getByPlaceholder('Найти эмодзи'); await expect(search).toBeFocused(); await search.press('Tab');
  const firstCell = grid.getByRole('gridcell').first(); await expect(firstCell).toBeFocused(); await firstCell.press('ArrowRight'); await page.keyboard.press('Home'); const keyboardMutation = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/api/reactions/')); await Promise.all([keyboardMutation, page.keyboard.press('Enter')]);
  const thumbChip = page.locator('.reaction-chip', { has: page.getByRole('button', { name: /реакцию 👍/i }) }); const count = thumbChip.getByRole('button', { name: 'Показать пользователей: 120' }); await expect(count).toBeVisible(); await count.click();
  await expect(page.getByRole('heading', { name: /Реакция/ })).toBeFocused();
  await expect(page.getByText('Reactor 49')).toBeVisible(); await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByText('Reactor 99')).toBeVisible(); await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByText('Reactor 119')).toBeVisible(); await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
});

test('G70-A03 late reaction response cannot revive a deleted message', async ({ page }) => {
  let releaseMutation!: () => void;
  const mutationBlocked = new Promise<void>((resolve) => { releaseMutation = resolve; });
  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, features: { ...body.features, reactions: true } } });
  });
  await page.route('**/api/reactions/**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, summaries: [] } });
    await mutationBlocked;
    return route.fulfill({ json: { ok: true, summary: { emoji: '👍', count: 1, reactedByMe: true, revision: '1' } } });
  });
  const login = uniqueLogin('reaction'); await registerViaUi(page, login);
  const roomId = await createPermanentRoom(page, `Reaction ${login}`); await enterRoom(page, roomId);
  await page.getByRole('button', { name: 'Чат', exact: true }).click();
  const input = page.getByPlaceholder('Написать в комнату…'); await input.fill('hostile reaction race'); await input.press('Enter');
  const message = page.locator('.chat-msg-text', { hasText: 'hostile reaction race' }); await expect(message).toBeVisible(); await message.hover();
  const mutationRequest = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/api/reactions/'));
  await Promise.all([mutationRequest, message.getByRole('button', { name: 'Добавить быструю реакцию 👍' }).click()]);
  // The mutation is now in flight and intentionally held by the route.
  await message.getByRole('button', { name: 'Удалить' }).click();
  await expect(message).toHaveCount(0);
  releaseMutation(); await page.waitForTimeout(100);
  await expect(page.getByText('hostile reaction race')).toHaveCount(0);
  await expect(page.locator('.reaction-chip')).toHaveCount(0);
});

test('G70-A04 two accounts and a guest enforce the real mutation boundary across contexts', async ({ browser, page }) => {
  test.skip(process.env.E2E_REAL_REACTIONS !== 'true','E2E_REAL_REACTIONS requires the release-test capability overlay');
  const enableReactions = async (target: typeof page) => target.route('**/api/capabilities', async (route) => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, features: { ...body.features, reactions: true } } }); });
  await enableReactions(page); const ownerLogin = uniqueLogin('reactionowner'); await registerViaUi(page, ownerLogin); const roomId = await createPermanentRoom(page, `Reaction contexts ${ownerLogin}`); await enterRoom(page, roomId);
  const memberContext = await browser.newContext(); const member = await memberContext.newPage(); await enableReactions(member); await registerViaUi(member, uniqueLogin('reactionmember')); await enterRoom(member, roomId);
  const guestContext = await browser.newContext(); const guest = await guestContext.newPage(); await enableReactions(guest); await guest.goto(`/r/${roomId}`); const guestDialog = guest.getByRole('dialog', { name: 'Как вас зовут?' }); await guestDialog.getByPlaceholder('Ваше имя').fill('Reaction Guest'); await guestDialog.getByRole('button', { name: 'Войти в комнату' }).click(); await expect(guest.locator('body')).toHaveAttribute('data-screen', 'room');
  for (const target of [page, member, guest]) await target.getByRole('button', { name: 'Чат', exact: true }).click();
  const input = page.getByPlaceholder('Написать в комнату…'); await input.fill('three-context reaction boundary'); await input.press('Enter');
  const memberMessage = member.locator('.chat-msg-text', { hasText: 'three-context reaction boundary' }); const guestMessage = guest.locator('.chat-msg-text', { hasText: 'three-context reaction boundary' }); await expect(memberMessage).toBeVisible(); await expect(guestMessage).toBeVisible();
  await memberMessage.hover(); await expect(memberMessage.getByRole('button', { name: /Добавить быструю реакцию/ }).first()).toBeVisible();
  const mutationResponse=member.waitForResponse((response)=>response.request().method()==='PUT'&&response.url().includes('/api/reactions/')); await memberMessage.getByRole('button', { name: 'Добавить быструю реакцию 👍' }).click(); const mutation=await mutationResponse; expect(mutation.ok(),await mutation.text()).toBe(true);
  await expect(member.locator('.reaction-chip').getByText('1'),'mutating member applies the authoritative API response').toBeVisible(); await expect(page.locator('.reaction-chip').getByText('1'),'owner receives reaction.updated').toBeVisible(); await expect(guest.locator('.reaction-chip').getByText('1'),'guest receives read-only reaction.updated').toBeVisible();
  await guestMessage.hover(); await expect(guestMessage.getByRole('button', { name: /Добавить быструю реакцию/ })).toHaveCount(0);
  await member.close(); const reconnected = await memberContext.newPage(); await enableReactions(reconnected); await enterRoom(reconnected, roomId); await reconnected.getByRole('button', { name: 'Чат', exact: true }).click();
  await expect(reconnected.locator('.chat-msg-text', { hasText: 'three-context reaction boundary' }).locator('.reaction-chip').getByText('1')).toBeVisible();
  const ownerMessage = page.locator('.chat-msg-text', { hasText: 'three-context reaction boundary' }); await ownerMessage.hover(); await ownerMessage.getByRole('button', { name: 'Добавить быструю реакцию 👍' }).click();
  for (const target of [page, reconnected, guest]) await expect(target.locator('.reaction-chip').getByText('2')).toBeVisible();
  await memberContext.close(); await guestContext.close();
});

test('G70-A02 real storage paginates 120 reactors through the production API', async ({ page }) => {
  test.skip(!process.env.E2E_DATABASE_URL, 'E2E_DATABASE_URL is required for the real 120-reactor storage scenario');
  await page.route('**/api/capabilities', async (route) => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, features: { ...body.features, reactions: true } } }); });
  const login = uniqueLogin('reactionreal'); await registerViaUi(page, login); const roomId = await createPermanentRoom(page, `Reaction real ${login}`); await enterRoom(page, roomId); await page.getByRole('button', { name: 'Чат', exact: true }).click();
  const input = page.getByPlaceholder('Написать в комнату…'); await input.fill('real 120 reactors'); await input.press('Enter');
  const message = page.locator('.chat-msg-text', { hasText: 'real 120 reactors' }); await expect(message).toBeVisible(); const messageId = await message.getAttribute('data-message-id'); expect(messageId).toBeTruthy();
  const { Client } = createRequire(import.meta.url)('pg'); const client = new Client({ connectionString:process.env.E2E_DATABASE_URL }); await client.connect();
  try {
    await client.query('BEGIN');
    for (let index=0;index<120;index+=1) { const userId=`g70-reactor-${String(index).padStart(3,'0')}`; await client.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES($1,$2,$3,'fixture') ON CONFLICT(id) DO NOTHING`,[userId,`g70r${String(index).padStart(3,'0')}`,`Real Reactor ${index}`]); await client.query(`INSERT INTO room_message_reactions(message_id,emoji,user_id,revision,created_at) VALUES($1,'👍',$2,120,current_timestamp+($3*interval '1 millisecond')) ON CONFLICT DO NOTHING`,[messageId,userId,index]); }
    await client.query(`INSERT INTO room_message_reaction_revisions(message_id,emoji,revision) VALUES($1,'👍',120) ON CONFLICT(message_id,emoji) DO UPDATE SET revision=120,updated_at=current_timestamp`,[messageId]); await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-screen','room'); await page.getByRole('button', { name:'Чат', exact:true }).click(); const restored=page.locator('.chat-msg-text',{hasText:'real 120 reactors'}); await expect(restored).toBeVisible(); const count=restored.getByRole('button',{name:'Показать пользователей: 120'}); await count.click();
  await expect(page.getByText('Real Reactor 49')).toBeVisible(); await page.getByRole('button',{name:'Показать ещё'}).click(); await expect(page.getByText('Real Reactor 99')).toBeVisible(); await page.getByRole('button',{name:'Показать ещё'}).click(); await expect(page.getByText('Real Reactor 119')).toBeVisible(); await expect(page.getByRole('button',{name:'Показать ещё'})).toHaveCount(0);
});
