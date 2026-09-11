import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const component = fs.readFileSync('src/lib/features/home/components/lobby/ModerationCenter.svelte', 'utf8');
const members = fs.readFileSync('src/lib/features/home/components/lobby/RoomMemberList.svelte', 'utf8');
const model = fs.readFileSync('src/lib/features/home/model/room-moderation.ts', 'utf8');
const api = fs.readFileSync('src/lib/api/moderation.ts', 'utf8');
const lobby = fs.readFileSync('src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte', 'utf8');
const room = fs.readFileSync('src/lib/features/room/components/RoomSettingsDialog.svelte', 'utf8');
const chat = fs.readFileSync('src/lib/features/room/components/RoomChatPanel.svelte', 'utf8');

test('G88-A01 owner center exposes complete, accessible moderation controls', async ({ page }) => {
  expect(component).toContain('fetchActiveBans(roomId');
  expect(model).toContain('1 час'); expect(model).toContain('1 день');
  expect(model).toContain('7 дней'); expect(model).toContain('Навсегда');
  expect(component).toContain('role="alert"');
  expect(model).toContain('Отменить'); expect(component).toContain('Активных блокировок нет');
  expect(members).toContain('<PopoverSubmenu label="Заблокировать"');
  expect(members).toContain('banRoomMember(roomId');
  expect(api).toContain('limit = MODERATION_DEFAULT_LIMIT');
  expect(api).toContain('Math.min(MODERATION_MAX_LIMIT');
  await page.setContent('<button aria-label="Снять блокировку участника">Разблокировать</button>');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Снять блокировку участника' })).toBeFocused();
});

test('G88-A02 both settings surfaces gate moderation sections and owners delete messages from the chat', () => {
  for (const dialog of [lobby, room]) {
    expect(dialog).toContain('{#if moderationEnabled}');
    expect(dialog).toContain('<RoomMemberList');
    expect(dialog).toContain('canModerate={moderationEnabled}');
    expect(dialog).toContain('<ModerationCenter');
  }
  expect(component).not.toContain('ID сообщения');
  expect(chat).toContain('canDelete={isOwnMessage(target) || canModerate}');
});
