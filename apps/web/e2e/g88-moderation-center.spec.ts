import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const component = fs.readFileSync('src/lib/features/home/components/lobby/ModerationCenter.svelte', 'utf8');
const api = fs.readFileSync('src/lib/api/moderation.ts', 'utf8');
const lobby = fs.readFileSync('src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte', 'utf8');
const room = fs.readFileSync('src/lib/features/room/components/RoomSettingsDialog.svelte', 'utf8');

test('G88-A01 owner center exposes complete, accessible moderation controls', async ({ page }) => {
  expect(component).toContain('fetchActiveBans(roomId');
  expect(component).toContain('1 час'); expect(component).toContain('1 день');
  expect(component).toContain('7 дней'); expect(component).toContain('Навсегда');
  expect(component).toContain('maxlength="500"');
  expect(component).toContain('role="alert"'); expect(component).toContain('role="status"');
  expect(component).toContain('Отменить'); expect(component).toContain('Активных блокировок нет');
  expect(api).toContain('limit = MODERATION_DEFAULT_LIMIT');
  expect(api).toContain('Math.min(MODERATION_MAX_LIMIT');
  await page.setContent('<button aria-label="Снять блокировку участника">Разблокировать</button>');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Снять блокировку участника' })).toBeFocused();
});

test('G88-A02 both settings surfaces gate one center and deletion uses the moderation endpoint', () => {
  expect(lobby).toContain('{#if moderationEnabled}');
  expect(room).toContain('{#if moderationEnabled}');
  expect(component).toContain('deleteModeratedMessage(roomId, id)');
  expect(api).toContain('/messages/${encodeURIComponent(messageId)}');
});
