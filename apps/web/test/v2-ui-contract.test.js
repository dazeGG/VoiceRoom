import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
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
