import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const roomSettings = read('src/lib/features/room/components/RoomSettingsDialog.svelte');
const lobbyRoomSettings = read('src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte');
const members = read('src/lib/features/home/components/lobby/RoomMemberList.svelte');
const bans = read('src/lib/features/home/components/lobby/ModerationCenter.svelte');
const model = read('src/lib/features/home/model/room-moderation.ts');
const chatPanel = read('src/lib/features/room/components/RoomChatPanel.svelte');

test('room settings split general, members and bans into sections', () => {
  for (const dialog of [roomSettings, lobbyRoomSettings]) {
    assert.match(dialog, /<nav class="settings-nav" aria-label="Разделы настроек комнаты">/);
    assert.match(dialog, /\{#if membershipEnabled \|\| moderationEnabled\}/);
    assert.match(dialog, /section === 'members' && membershipEnabled[\s\S]*<RoomMemberList[^>]*canModerate=\{moderationEnabled\}[^>]*onNotify=\{notifyModeration\}/);
    assert.match(dialog, /section === 'bans' && moderationEnabled[\s\S]*<ModerationCenter[^>]*onNotify=\{notifyModeration\}/);
    // Opening the dialog always lands on the general section.
    assert.match(dialog, /section = 'general';/);
    // Escape closes an open member menu first, not the dialog under it.
    assert.match(dialog, /popover-submenu-panel, \.popover-panel--floating/);
  }
});

test('owners ban a member from a popup menu with a timed undo', () => {
  assert.match(members, /\{#if canModerateMember\(member\)\}[\s\S]*<Popover[^>]*floating[^>]*role="menu"/);
  assert.match(members, /member\.role !== 'owner' && member\.userId !== session\.user\?\.id/);
  assert.match(members, /<PopoverSubmenu label="Заблокировать"[\s\S]*\{#each BAN_DURATIONS as option/);
  assert.match(model, /putBan\(roomId, \{ userId: member\.userId, guestIp: null, duration, reason: '' \}/);
  assert.match(model, /undo: \{ label: 'Отменить', run: /);
  assert.match(roomSettings, /actionLabel: options\.undo\?\.label,\s*action: options\.undo\?\.run/);
  assert.match(lobbyRoomSettings, /onClick: \(toastId\) => \{ dismissToast\(toastId\); undo\.run\(\); \}/);
});

test('the bans section names people and no longer asks for raw ids', () => {
  assert.match(bans, /banSubjectName\(ban\)/);
  assert.match(bans, /ban\.subject\.profile\?\.avatarUrl/);
  assert.match(bans, /aria-label=\{`Снять блокировку \$\{name\}`\}/);
  assert.doesNotMatch(bans, /ID участника|ID сообщения|deleteModeratedMessage|<form/);
});

test('owners delete any room message from the chat menu', () => {
  assert.match(chatPanel, /canModerate = false,/);
  assert.match(chatPanel, /canDelete=\{isOwnMessage\(target\) \|\| canModerate\}/);
  assert.match(read('src/lib/features/room/components/RoomChat.svelte'), /canModerate=\{roomSettingsUi\.isOwner\}/);
  for (const view of ['RoomPreviewView', 'RoomBrowseView']) {
    assert.match(read(`src/lib/features/home/components/lobby/${view}.svelte`), /canModerate=\{room\.relationship === 'owner'\}/);
  }
});
