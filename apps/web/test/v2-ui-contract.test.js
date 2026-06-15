import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('home auth flow is loader-first and has no localStorage session oracle', () => {
  const session = read('src/lib/features/auth/session.svelte.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const sources = `${session}\n${home}`;

  assert.doesNotMatch(sources, /SESSION_HINT_KEY|hasSessionHint|setSessionHint|voice-room:has-session/);
  assert.match(home, /auth-loader/);
  assert.match(home, /session\.loaded && Boolean\(user\)/);
  assert.match(session, /removeItem\('voice-room:name'\)/);
  assert.match(session, /catch\(\(error\) => \{/);
  assert.match(session, /throw error/);
  assert.match(home, /authLoadError/);
  assert.match(home, /auth-session-error/);
  assert.match(home, /Не удалось проверить аккаунт/);
  assert.match(home, /retrySessionLoad/);
});

test('lobby grid add action is add-by-code, not create-room', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const authApi = read('src/lib/api/auth.ts');

  assert.match(authApi, /addRoomByCode/);
  assert.match(authApi, /authPost<\{ room: OwnedRoom \}>\('\/auth\/rooms'/);
  assert.match(lobby, /handleAddRoom/);
  assert.match(lobby, /addDialogOpen = true/);
  assert.match(lobby, /Введите код уже созданной постоянной комнаты/);
});

test('room chat keeps transport mounted and tracks unread state while closed', () => {
  const stage = read('src/lib/features/room/components/RoomStage.svelte');
  const ui = read('src/lib/features/room/room-ui.svelte.ts');
  const chat = read('src/lib/features/room/components/RoomChat.svelte');
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');

  assert.match(stage, /<RoomChat \/>/);
  assert.match(ui, /unreadChat: 0/);
  assert.match(ui, /incrementUnreadChat/);
  assert.match(chat, /messageIds/);
  assert.match(chat, /incrementUnreadChat\(\)/);
  assert.match(topbar, /room-chat-unread/);
});


test('auth client does not mask unexpected backend failures as anonymous or empty state', () => {
  const authApi = read('src/lib/api/auth.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  assert.match(authApi, /throw new Error\('Не удалось проверить сессию'\)/);
  assert.match(authApi, /throw new Error\('Не удалось загрузить комнаты'\)/);
  assert.doesNotMatch(authApi, /if \(!response\.ok\) return null/);
  assert.doesNotMatch(authApi, /if \(!response\.ok\) return \[\]/);
  assert.match(home, /await logout\(\);\n\s+clearSession\(\);/);
  assert.match(home, /Не удалось выйти из аккаунта/);
  assert.match(lobby, /Не удалось загрузить комнаты/);
});

test('visual identity UI consumes backend keys and exposes only curated room presets', () => {
  const authApi = read('src/lib/api/auth.ts');
  const roomsApi = read('src/lib/api/rooms.ts');
  const tokens = read('src/lib/visual/tokens.ts');
  const userMenu = read('src/lib/features/home/components/UserMenu.svelte');
  const roomCard = read('src/lib/features/home/components/RoomCard.svelte');
  const createDialog = read('src/lib/features/home/components/CreateRoomDialog.svelte');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const chat = read('src/lib/features/room/components/RoomChat.svelte');
  const roomNet = read('src/lib/features/room/client/net/api.ts');
  const roomView = read('src/lib/features/room/client/room/room.ts');

  assert.match(authApi, /avatarColorKey: string/);
  assert.match(authApi, /roomIconKey: string/);
  assert.match(authApi, /roomColorKey: string/);
  assert.match(roomsApi, /avatarColorKey: string/);
  assert.match(roomsApi, /roomPresetKey\?: string/);
  assert.match(tokens, /export const AVATAR_COLORS/);
  assert.match(tokens, /export const ROOM_PRESETS/);
  assert.match(userMenu, /getAvatarColor\(user\.avatarColorKey\)/);
  assert.match(roomCard, /roomVisual\(room\)/);
  assert.match(createDialog, /ROOM_PRESETS/);
  assert.match(createDialog, /roomPresetKey/);
  assert.doesNotMatch(createDialog, /type="file"|upload|custom|contenteditable/i);
  assert.match(participants, /getAvatarColor\(peerInfo\.avatarColorKey\)/);
  assert.doesNotMatch(participants, /hashStringToHue\(seed\)/);
  assert.match(chat, /getAvatarColor\(message\.avatarColorKey\)/);
  assert.doesNotMatch(chat, /hashStringToHue/);
  assert.match(roomNet, /status\?\.roomIconKey/);
  assert.match(roomView, /getRoomPreset/);
  assert.match(roomView, /updateParticipant\(\{ \.\.\.message\.peer, isLocal: true \}\)/);
  assert.match(tokens, /ROOM_ICON_EMOJIS/);
  assert.match(tokens, /ROOM_COLOR_TOKENS/);
  assert.match(tokens, /key: '',/);
  assert.doesNotMatch(roomCard, /room\.emoji \|\| visual\.emoji/);
  assert.doesNotMatch(roomView, /state\.roomEmoji \|\| roomVisual\.emoji/);
  assert.ok(tokens.indexOf('if (hasIconKey || hasColorKey)') < tokens.indexOf('item.emoji === value.emoji'));
});



test('local participant updates do not remove the self tile when LiveKit mute events resync', () => {
  const participants = read('src/lib/features/room/client/room/participants.ts');

  assert.match(participants, /const duplicate = state\.peers\.get\(peerInfo\.id\)/);
  assert.match(participants, /if \(duplicate\) removeParticipantView\(duplicate\.id\)/);
  assert.doesNotMatch(participants, /removeParticipantView\(duplicate\?\.id \|\| peerInfo\.id\)/);
});

test('participant tiles stay visually uniform and highlight only active speakers', () => {
  const css = read('src/lib/features/room/styles/participants.css');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const meters = read('src/lib/features/room/client/media/meters.ts');
  const livekit = read('src/lib/features/room/client/services/livekit-service.ts');

  assert.match(css, /\.participant\[data-speaking="true"\]/);
  assert.match(css, /border-color: var\(--green\)/);
  assert.match(css, /\.participant\[data-speaking="true"\] \.voice-ring/);
  assert.doesNotMatch(css, /\.participant\[data-local="true"\]\s*\{\s*border-color/s);
  assert.match(participants, /view\.node\.dataset\.speaking = String\(Boolean\(speaking\)\)/);
  assert.match(meters, /setParticipantSpeaking\(participant, isLocalMicrophoneSpeaking/);
  assert.match(livekit, /RoomEvent\.ActiveSpeakersChanged/);
});

test('frontend visual catalog stays aligned with shared backend key contracts', () => {
  const shared = require('@voice-room/shared/validation');
  const tokens = read('src/lib/visual/tokens.ts');

  for (const key of shared.AVATAR_COLOR_KEYS) {
    assert.ok(tokens.includes(`${key}: { key: '${key}'`));
  }
  assert.match(tokens, /@voice-room\/shared\/visual-identity/);
  assert.match(tokens, /visualIdentity\.ROOM_PRESETS\.map/);
  assert.doesNotMatch(tokens, /key: 'voice-blue'/);
  assert.doesNotMatch(tokens, /emoji: '🎧'/);
  for (const key of shared.ROOM_COLOR_KEYS) {
    assert.ok(tokens.includes(`${key}: { background:`));
  }
});
