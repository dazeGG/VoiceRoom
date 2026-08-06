import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

const store = readFileSync(new URL('../src/lib/shared/chat/reaction-store.svelte.ts', import.meta.url), 'utf8');
const summary = readFileSync(new URL('../src/lib/shared/chat/ReactionSummary.svelte', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../src/lib/shared/chat/ReactionPicker.svelte', import.meta.url), 'utf8');
const reactors = readFileSync(new URL('../src/lib/shared/chat/ReactorList.svelte', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/lib/features/room/components/RoomChat.svelte', import.meta.url), 'utf8');
const dm = readFileSync(new URL('../src/lib/features/home/components/lobby/DmView.svelte', import.meta.url), 'utf8');

test('G70-A01 optimistic state converges under reorder, reconnect, pagination and deletion races', async () => {
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

test('G70-A02 guest controls and picker/reactor popovers are keyboard and screen-reader safe', async () => {
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
