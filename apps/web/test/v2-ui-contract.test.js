import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

// The in-room rail and the lobby preview are thin wrappers over one shared chat
// panel, so a contract about "the room chat" holds across the wrapper plus the
// panel it renders.
const ROOM_CHAT_PANEL_PATH = 'src/lib/features/room/components/RoomChatPanel.svelte';
const readRoomChat = () => `${read('src/lib/features/room/components/RoomChat.svelte')}
${read(ROOM_CHAT_PANEL_PATH)}`;
const readPreviewChat = () => `${read('src/lib/features/home/components/lobby/RoomPreviewChat.svelte')}
${read(ROOM_CHAT_PANEL_PATH)}`;

async function importTypeScript(path) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function readTree(path, matcher) {
  const absolute = resolve(root, path);
  const entries = readdirSync(absolute);
  const sources = [];
  for (const entry of entries) {
    const child = `${path}/${entry}`;
    const childAbsolute = resolve(root, child);
    if (statSync(childAbsolute).isDirectory()) {
      sources.push(...readTree(child, matcher));
    } else if (matcher(child)) {
      sources.push(read(child));
    }
  }
  return sources;
}

function readTreeFiles(path, matcher) {
  const absolute = resolve(root, path);
  const entries = readdirSync(absolute);
  const files = [];
  for (const entry of entries) {
    const child = `${path}/${entry}`;
    const childAbsolute = resolve(root, child);
    if (statSync(childAbsolute).isDirectory()) {
      files.push(...readTreeFiles(child, matcher));
    } else if (matcher(child)) {
      files.push({ path: child, source: read(child) });
    }
  }
  return files;
}

function assertRuleFont(source, selector, fontToken) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    source,
    new RegExp(`${escapedSelector}\\s*\\{[^}]*font-family: var\\(${fontToken.replace(/[()]/g, '\\$&')}(?:[,\\)])`),
    `${selector} uses ${fontToken}`
  );
}

function fontRangesByFamily(typography) {
  const ranges = new Map();
  const fontFacePattern = /@font-face\s*\{(?<body>[^}]+)\}/g;
  for (const match of typography.matchAll(fontFacePattern)) {
    const family = match.groups.body.match(/font-family:\s*'(?<family>[^']+)'/);
    const weight = match.groups.body.match(/font-weight:\s*(?<min>\d+)\s+(?<max>\d+)/);
    if (!family || !weight) continue;
    const max = Number(weight.groups.max);
    ranges.set(family.groups.family, Math.max(ranges.get(family.groups.family) ?? 0, max));
  }
  return ranges;
}

function fontFamiliesByRole(typography) {
  const roles = new Map();
  const rolePattern = /--font-(?<role>ui|display|mono):\s*'(?<family>[^']+)'/g;
  for (const match of typography.matchAll(rolePattern)) {
    roles.set(match.groups.role, match.groups.family);
  }
  return roles;
}

function assertSupportedFontWeights(files, typography) {
  const ranges = fontRangesByFamily(typography);
  const families = fontFamiliesByRole(typography);
  const problems = [];
  const blockPattern = /(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g;

  for (const file of files) {
    for (const block of file.source.matchAll(blockPattern)) {
      const body = block.groups.body;
      const explicitRole = body.match(/font(?:-family)?:\s*[^;]*var\(--font-(?<role>ui|display|mono)\b/);
      const role = explicitRole?.groups.role ?? 'ui';
      const family = families.get(role);
      const max = ranges.get(family);
      assert.ok(max, `${role} font role resolves to a declared @font-face range`);

      const weightPattern = /font-weight:\s*(?<weight>\d{3})\b|font:\s*(?<fontWeight>\d{3})\b/g;
      for (const weightMatch of body.matchAll(weightPattern)) {
        const weight = Number(weightMatch.groups.weight ?? weightMatch.groups.fontWeight);
        if (weight <= max) continue;
        const line = file.source.slice(0, block.index + weightMatch.index).split('\n').length;
        const selector = block.groups.selector.trim().replace(/\s+/g, ' ');
        problems.push(`${file.path}:${line} ${selector} requests ${role}/${family} ${weight}, max ${max}`);
      }
    }
  }

  assert.deepEqual(problems, []);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} function is present`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`${name} function body is closed`);
}

test('home auth flow is loader-first and has no localStorage session oracle', () => {
  const session = read('src/lib/features/auth/session.svelte.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const authDialog = read('src/lib/features/auth/AuthDialog.svelte');
  const loginRoute = read('src/routes/login/+page.svelte');
  const registerRoute = read('src/routes/register/+page.svelte');
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
  assert.match(home, /<AuthDialog mode=\{authMode\}/);
  assert.match(home, /href="\/\?auth=login"/);
  assert.match(home, /href="\/\?auth=register"/);
  assert.match(authDialog, /dialog\.showModal\(\)/);
  assert.match(authDialog, /oncancel=\{handleCancel\}/);
  assert.match(authDialog, /event\.target === dialog/);
  assert.match(loginRoute, /<HomePage initialAuthMode="login"/);
  assert.match(registerRoute, /<HomePage initialAuthMode="register"/);
  assert.equal(existsSync(resolve(root, 'src/lib/features/auth/LoginPage.svelte')), false);
  assert.equal(existsSync(resolve(root, 'src/lib/features/auth/RegisterPage.svelte')), false);
  assert.equal(existsSync(resolve(root, 'src/lib/features/auth/AuthShell.svelte')), false);
});

test('page CSP supports runtime LiveKit origins while production Caddy narrows them', () => {
  const config = read('svelte.config.js');
  const caddy = read('../../Caddyfile');
  const compose = read('../../docker-compose.yml');
  const dockerfile = read('../../Dockerfile');
  const cspBlock = config.slice(config.indexOf("'connect-src'"), config.indexOf("'default-src'"));

  assert.match(config, /function liveKitConnectSources/);
  assert.ok(cspBlock.includes('...liveKitConnectSources()'));
  for (const scheme of ["'http:'", "'https:'", "'ws:'", "'wss:'"]) {
    assert.ok(cspBlock.includes(scheme), `missing runtime connect scheme ${scheme}`);
  }
  assert.ok(cspBlock.includes("'ws://localhost:*'"));
  assert.ok(cspBlock.includes("'ws://127.0.0.1:*'"));
  assert.match(
    caddy,
    /Content-Security-Policy "frame-ancestors 'none'; connect-src 'self' wss:\/\/\{\$LIVEKIT_DOMAIN\} https:\/\/\{\$LIVEKIT_DOMAIN\} stun: turn: turns:"/
  );
  assert.match(dockerfile, /FROM caddy:2\.11\.3-alpine AS web/);
  assert.match(compose, /\n  caddy:\n[\s\S]*?image: \$\{VOICEROOM_WEB_IMAGE:\?set immutable VOICEROOM_WEB_IMAGE digest\}/);
  assert.ok(config.includes("'style-src': ['self', 'unsafe-inline']"));
  assert.match(config, /style attributes/);
});

test('lobby join is the single room-code action and explains auto-save', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const voiceHome = read('src/lib/features/home/components/lobby/VoiceHome.svelte');
  const authApi = read('src/lib/api/auth.ts');

  assert.match(authApi, /addRoomByCode/);
  assert.match(authApi, /authPost<\{ room: OwnedRoom \}>\('\/auth\/rooms'/);
  assert.doesNotMatch(lobby, /handleAddRoom|addDialogOpen|addRoomCode|addError|\badding\b/);
  assert.doesNotMatch(lobby, /Введите код уже созданной постоянной комнаты|Комната добавлена/);
  assert.doesNotMatch(voiceHome, /onAddRoom|Добавить комнату по коду|lr-icon-btn/);
  assert.match(voiceHome, /placeholder="Код или ссылка"/);
  assert.match(voiceHome, /aria-describedby="roomAutoSaveHint"/);
  assert.match(voiceHome, /id="roomAutoSaveHint"/);
  assert.match(voiceHome, /Постоянные комнаты сохраняются автоматически/);
});

test('active voice widget uses the shared room fallback and leave cue parity', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const widget = read('src/lib/features/home/components/lobby/VoiceCallWidget.svelte');
  const voiceSession = read('src/lib/features/room/voice-session.svelte.ts');
  const roomView = read('src/lib/features/room/client/room/room.ts');
  const leaveConnectedVoiceRoom = functionBody(lobby, 'leaveConnectedVoiceRoom');
  const leaveWithCue = functionBody(voiceSession, 'leaveActiveVoiceRoomWithCue');
  const dockLeave = functionBody(roomView, 'handleLeaveButtonClick');

  assert.match(lobby, /import \{ roomDisplayName \} from '\.\/model\/rooms'/);
  assert.match(sidebar, /roomName=\{activeVoiceLabel\}/);
  assert.match(widget, /<Avatar name=\{roomName\} src=\{avatarUrl\} shape="squircle" background="var\(--room-avatar-bg\)" size=\{42\} \/>/);
  assert.doesNotMatch(widget, /RoomPresetToken|getRoomPreset|visual\.emoji/);

  assert.match(lobby, /leaveActiveVoiceRoomWithCue/);
  assert.match(leaveConnectedVoiceRoom, /await leaveActiveVoiceRoomWithCue\(\)/);
  assert.match(voiceSession, /import \{ playPeerCue \} from '\.\/client\/media\/cues'/);
  assert.match(voiceSession, /import \{ wait \} from '\.\/client\/core\/utils'/);
  assert.match(leaveWithCue, /playPeerCue\('leave'\)/);
  assert.match(leaveWithCue, /await wait\(180\)/);
  assert.match(leaveWithCue, /activeLeaveHandler\(\)/);

  assert.match(dockLeave, /playPeerCue\('leave'\)/);
  assert.match(dockLeave, /await wait\(180\)/);
});

test('lobby separates viewed room from connected voice room', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const browseView = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');
  const voiceSession = read('src/lib/features/room/voice-session.svelte.ts');
  const roomNavigation = read('src/lib/features/home/model/room-navigation.svelte.ts');
  const previewRoom = functionBody(lobby, 'previewRoom');
  const enterRoom = functionBody(lobby, 'enterRoom');
  const leaveConnectedVoiceRoom = functionBody(lobby, 'leaveConnectedVoiceRoom');
  const closeViewedRoom = functionBody(lobby, 'closeViewedRoom');
  const onEmbeddedLeave = functionBody(lobby, 'onEmbeddedLeave');
  const replaceUrlWithActiveVoiceRoom = functionBody(lobby, 'replaceUrlWithActiveVoiceRoom');

  assert.match(lobby, /roomNavigation\.viewedRoomId/);
  assert.match(lobby, /connectedRoomIsViewed\(friendsState\.mode\)/);
  assert.match(lobby, /embeddedRoomIsVisible\(friendsState\.mode\)/);
  assert.match(roomNavigation, /viewedRoomId: string \| null/);
  assert.match(roomNavigation, /embeddedRoomId: string \| null/);
  assert.match(roomNavigation, /joinIntentRoomId: string \| null/);
  assert.match(roomNavigation, /export function getActiveVoiceRoomId/);
  assert.match(roomNavigation, /Room-navigation state machine/);
  assert.match(roomNavigation, /viewedRoomId is the room rendered by the app shell and may be a URL-free preview/);
  assert.match(roomNavigation, /browser \/r\/:roomId route mirrors active voice membership, not preview selection/);
  assert.match(roomNavigation, /embeddedRoomId is the mounted room client/);
  assert.match(roomNavigation, /browsing\n\/\/   never creates it/);
  assert.match(roomNavigation, /joinIntentRoomId is set only by an explicit Enter action/);
  assert.match(roomNavigation, /function setViewedRoomFromRoute/);
  assert.match(roomNavigation, /export function routeToRoom/);
  assert.match(roomNavigation, /export function routeToHome/);
  assert.match(roomNavigation, /export function leaveViewedConnectedRoom/);
  assert.doesNotMatch(functionBody(roomNavigation, 'routeToRoom'), /roomNavigation\.embeddedRoomId = roomId/);
  assert.match(previewRoom, /selectRoomPreview\(roomId\)/);
  assert.doesNotMatch(previewRoom, /leaveActiveVoiceRoom|setConnectedVoiceRoom|clearConnectedVoiceRoom/);
  assert.doesNotMatch(previewRoom, /history\.(?:push|replace)State/);
  assert.match(previewRoom, /replaceUrlWithActiveVoiceRoom\(\)/);
  assert.match(replaceUrlWithActiveVoiceRoom, /roomId \? `\/r\/\$\{encodeURIComponent\(roomId\)\}` : '\/'/);
  assert.match(replaceUrlWithActiveVoiceRoom, /replaceState\(target, \{\}\)/);
  assert.match(enterRoom, /selectRoomForVoiceEntry\(roomId\)/);
  assert.match(roomNavigation, /roomNavigation\.embeddedRoomId = roomId/);
  assert.match(roomNavigation, /roomNavigation\.joinIntentRoomId = roomId/);
  assert.match(enterRoom, /friendsState\.mode = 'rooms'/);
  assert.match(
    lobby,
    /async function handleCreate[\s\S]*const roomId = await createRoom\(payload\);[\s\S]*createDialogOpen = false;[\s\S]*enterRoom\(roomId\);[\s\S]*if \(payload\.isStatic\) void refreshRooms\(\)/
  );
  assert.match(closeViewedRoom, /const transition = routeToHome\(\)/);
  assert.match(closeViewedRoom, /if \(transition\.closeEmbeddedRoom\) closeEmbeddedRoom\(\{ replaceUrl: false \}\)/);
  assert.match(closeViewedRoom, /replaceUrlWithActiveVoiceRoom\(\)/);
  assert.match(lobby, /function closeEmbeddedRoom\(\{ replaceUrl = true, closedRoomId = embeddedRoomId \}/);
  assert.match(lobby, /replaceUrl && closedRoomId && extractRoomId\(window\.location\.pathname\) === closedRoomId/);
  assert.match(onEmbeddedLeave, /event instanceof CustomEvent/);
  assert.match(onEmbeddedLeave, /event\.detail\?\.roomId/);
  assert.match(onEmbeddedLeave, /const closedViewedRoom = Boolean\(closedRoomId && selectedRoomId === closedRoomId\)/);
  assert.match(onEmbeddedLeave, /closeEmbeddedRoom\(\{ closedRoomId \}\)/);
  assert.match(onEmbeddedLeave, /if \(closedViewedRoom\) clearViewedRoom\(\)/);
  assert.match(leaveConnectedVoiceRoom, /const leavingRoomId = connectedVoiceRoomId/);
  assert.match(leaveConnectedVoiceRoom, /leaveActiveVoiceRoomWithCue\(\)/);
  assert.match(leaveConnectedVoiceRoom, /resolveLeaveViewedConnectedRoom\(leavingRoomId\)/);
  assert.match(leaveConnectedVoiceRoom, /closeEmbeddedRoom\(\)/);
  assert.match(leaveConnectedVoiceRoom, /replaceUrlWithActiveVoiceRoom\(null\)/);
  assert.ok(
    leaveConnectedVoiceRoom.indexOf('closeEmbeddedRoom()') < leaveConnectedVoiceRoom.indexOf('clearViewedRoom()'),
    'sidebar leave restores URL before clearing the viewed room'
  );
  assert.match(lobby, /<RoomBrowseView \{user\} room=\{selectedRoom\} onEnter=\{\(\) => enterRoom\(selectedRoom\.roomId\)\}/);
  assert.match(lobby, /dataset\.lobbyEmbedded = 'true'/);
  assert.match(lobby, /delete document\.body\.dataset\.lobbyEmbedded/);
  assert.match(browseView, /subscribeRoomPreview\(roomId, handlePreviewEvent\)/);
  assert.match(browseView, /let loadError = \$state\(''\)/);
  assert.match(browseView, /event\.type === 'room\.not_found'/);
  assert.match(browseView, /Комната не найдена/);
  assert.match(browseView, /role="status"/);
  assert.match(voiceSession, /registerActiveVoiceLeave/);
  assert.match(roomNavigation, /export function connectedRoomIsViewed/);
  assert.match(roomNavigation, /export function embeddedRoomIsVisible/);
  assert.match(lobby, /autoJoin=\{autoJoinRoomId === embeddedRoomId\}/);

  const roomPage = read('src/lib/features/room/RoomPage.svelte');
  const roomClient = read('src/lib/features/room/client/main.ts');
  const roomView = read('src/lib/features/room/client/room/room.ts');
  const entryError = read('src/lib/features/room/components/RoomEntryErrorScreen.svelte');

  assert.match(roomPage, /RoomEntryErrorScreen/);
  assert.equal(existsSync(resolve(root, 'src/lib/features/room/client/ui/dom.ts')), false);
  assert.match(roomClient, /showRoomRoute\(\)/);
  assert.match(entryError, /id="entryRetryButton"/);
  assert.match(entryError, /showRoomRoute\(\)/);
  assert.match(roomView, /export function showRoomEntryFailure/);
  assert.match(roomView, /if \(entryGate === 'failure'\) \{[\s\S]*showRoomEntryFailure\(\);[\s\S]*return false;[\s\S]*\}/);
  assert.match(entryError, /Повторить проверку/);
});

test('room chat keeps transport mounted and tracks unread state while closed', () => {
  const stage = read('src/lib/features/room/components/RoomStage.svelte');
  const ui = read('src/lib/features/room/room-ui.svelte.ts');
  const chat = readRoomChat();
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const roomMenu = read('src/lib/shared/components/room-menu/RoomMenu.svelte');
  const roomMenuContent = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');

  assert.match(stage, /<RoomChat \/>/);
  assert.match(ui, /unreadChat: 0/);
  assert.match(ui, /incrementUnreadChat/);
  assert.match(chat, /messageIds/);
  assert.match(chat, /onUnreadMessage=\{incrementUnreadChat\}/);
  assert.match(chat, /onUnreadMessage\?\.\(\)/);
  // 2.4.0 chat multiline + links
  assert.match(chat, /ChatText/);
  assert.match(chat, /chat-rail-textarea/);
  assert.match(chat, /onComposeKeydown|onkeydown=\{onComposeKeydown\}/);
  assert.doesNotMatch(chat, /draft\.replace\(\/\\s\+\/g, ' '\)/);
  assert.match(topbar, /room-panel-tab-unread/);
  assert.match(topbar, /inviteContent=/);
  assert.match(topbar, /import \{ RoomInviteFriendList, RoomMenu \} from '\$lib\/shared\/components\/room-menu'/);
  assert.match(topbar, /<RoomMenu/);
  assert.match(topbar, /headingClass="room-heading-title-wrap"/);
  assert.match(topbar, /\bheading\b/);
  assert.match(topbar, /room-heading-trigger/);
  assert.match(topbar, /keepContentMounted/);
  assert.match(topbar, /avatarUrl=\{roomClientState\.roomAvatarUrl\}/);
  assert.match(roomMenu, /<div class=\{headingClass\} role="heading" aria-level="1">/);
  assert.doesNotMatch(roomMenu, /<h1 class=\{headingClass\}>/);
  assert.match(roomMenu, /<Avatar \{name\} src=\{avatarUrl\} shape="squircle" background="var\(--room-avatar-bg\)"/);
  assert.match(roomMenu, /<RoomMenuContent[\s\S]*\{roomId\}[\s\S]*\{name\}[\s\S]*\{avatarUrl\}/);
  assert.match(roomMenuContent, /Скопировать код/);
  assert.match(roomMenuContent, /room-menu-head/);
  assert.match(roomMenuContent, /room-menu-info/);
  assert.doesNotMatch(topbar, /copyCodeButton|copyLinkButton|room-settings-button/);

  // Heading (title/code) is rendered reactively from room state, not written
  // imperatively by the vanilla client. The plain `.ellipsis` spans are gone.
  assert.match(topbar, /import \{ state as roomClientState \} from '\.\.\/client\/core\/state\.svelte'/);
  assert.match(topbar, /const heading = \$derived\(roomClientState\.roomName \|\| roomClientState\.roomId\)/);
  assert.match(roomMenu, /<Ellipsis text=\{name\} title=\{roomId\}/);
  assert.match(roomMenuContent, /<Ellipsis class="room-menu-code" text=\{roomId\}/);
  assert.doesNotMatch(topbar, /id="roomTitle"|id="roomCodeText"|class="[^"]*\bellipsis\b/);

  const roomView = read('src/lib/features/room/client/room/room.ts');
  assert.match(roomView, /document\.title = `\$\{heading\} · Voice Room`/);
  assert.doesNotMatch(roomView, /elements\.roomTitle|#roomCodeText|roomPopoverEmojiBadge/);

  const select = read('src/lib/shared/ui/Select/Select.svelte');
  assert.match(select, /import \{ Ellipsis \} from '\.\.\/Ellipsis'/);

  const dock = read('src/lib/features/room/components/RoomDock.svelte');
  assert.match(dock, /dock-anchor/);
  assert.match(dock, /flip/);
  const controls = read('src/lib/features/room/styles/controls.css');
  assert.match(controls, /\.device-popover[\s\S]*overflow:\s*visible/);
  assert.match(controls, /\.dock-anchor/);
  assert.match(controls, /\.device-popover[\s\S]*left:\s*50%/);
  assert.match(controls, /translateX\(-50%\)/);

  assert.match(select, /\.select-trigger--dock \.select-trigger-chevron[\s\S]*right:\s*11px/);
});

test('room chat terminal lifecycle frames leave the room screen', () => {
  const chat = readRoomChat();
  const lifecycle = read('src/lib/features/room/client/room/lifecycle.ts');

  assert.match(lifecycle, /export function applyRoomNotFound/);
  assert.match(chat, /applyRoomNotFound/);
  assert.match(chat, /event\.type === 'room\.not_found'[\s\S]*applyRoomNotFound\(event\.payload\.roomId\)/);
  assert.match(chat, /event\.type === 'room\.deleted'[\s\S]*applyRoomDeleted\(event\.payload\.roomId\)/);
  // Chat must hold a server-side preview subscription: the API only routes
  // room events to preview subscribers or active voice peers, so a bare
  // connection-level subscribe would go silent until the user joins voice.
  assert.match(chat, /subscribeRoomPreview\(roomId/);
  assert.doesNotMatch(chat, /getAppRealtime\(\)\.subscribe/);
});

test('room side panel exposes chat and participant tabs backed by the authoritative roster', () => {
  const chat = readRoomChat();
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const memberList = read('src/lib/features/home/components/lobby/RoomMemberList.svelte');
  const membershipApi = read('src/lib/api/memberships.ts');
  const stage = read('src/lib/features/room/components/RoomStage.svelte');
  const ui = read('src/lib/features/room/room-ui.svelte.ts');
  const css = read('src/lib/features/room/styles/chat-rail.css');
  const layoutCss = read('src/lib/features/room/styles/layout.css');
  const controlsCss = read('src/lib/features/room/styles/controls.css');
  const friendsCss = read('src/lib/features/home/styles/friends.css');

  assert.match(chat, /role="tablist"/);
  assert.match(chat, /aria-label="Чат"/);
  assert.match(chat, /title="Чат"/);
  assert.match(chat, /<MessageSquare/);
  assert.match(chat, /aria-label="Участники"/);
  assert.match(chat, /title="Участники"/);
  assert.match(chat, /<Users/);
  assert.match(chat, /aria-selected=\{activeTab === 'chat'\}/);
  assert.match(chat, /aria-selected=\{activeTab === 'participants'\}/);
  assert.match(chat, /activeTab=\{roomUi\.activePanel === 'participants' \? 'participants' : 'chat'\}/);
  assert.match(chat, /aria-label="Свернуть панель"/);
  assert.match(chat, /onCollapse=\{closeChat\}/);
  assert.match(topbar, /role="group" aria-label="Открыть раздел панели комнаты"/);
  assert.match(topbar, /aria-label="Чат"/);
  assert.match(topbar, /aria-label="Участники"/);
  assert.match(topbar, /aria-pressed=\{roomUi\.chatOpen && roomUi\.activePanel === 'chat'\}/);
  assert.match(topbar, /aria-pressed=\{roomUi\.chatOpen && roomUi\.activePanel === 'participants'\}/);
  assert.match(topbar, /onclick=\{\(\) => openRoomPanel\('chat'\)\}/);
  assert.match(topbar, /onclick=\{\(\) => openRoomPanel\('participants'\)\}/);
  assert.doesNotMatch(topbar, /toggleChat|class="room-chat-toggle"/);
  assert.match(ui, /activePanel: 'chat'/);
  assert.match(ui, /roomUi\.chatOpen && roomUi\.activePanel === 'chat'/);
  assert.match(chat, /<RoomMemberList \{roomId\} \/>/);
  assert.match(membershipApi, /fetchRoomMemberships/);
  assert.match(membershipApi, /\/api\/rooms\/\$\{encodeURIComponent\(roomId\)\}\/members/);
  assert.match(memberList, /В сети — \{onlineMembers\.length\}/);
  assert.match(memberList, /Не в сети — \{offlineMembers\.length\}/);
  assert.match(memberList, /member\.presenceStatus !== 'offline'/);
  assert.match(memberList, /member\.presenceStatus === 'offline'/);
  assert.doesNotMatch(memberList, /Найти участника|room-member-list__search|Search/);
  assert.doesNotMatch(memberList, /<h2[^>]*>Участники<\/h2>|Создатель/);
  assert.doesNotMatch(stage, /room-members-rail|data-members-open/);
  assert.match(css, /\.room-panel-tabs button\[data-active='true'\]/);
  assert.match(css, /--room-panel-width:\s*360px/);
  assert.match(css, /\.room-chat-rail\s*\{[\s\S]*width:\s*var\(--room-panel-width\)/);
  assert.match(friendsCss, /\.lobby-preview-chat\s*\{[\s\S]*width:\s*var\(--room-panel-width\)/);
  assert.match(friendsCss, /\.lobby-room-members\s*\{[\s\S]*width:\s*var\(--room-panel-width\)/);
  assert.match(friendsCss, /data-preview-chat-open='true'\][\s\S]*padding-right:\s*var\(--room-panel-width\)/);
  assert.match(friendsCss, /data-members-open='true'\][\s\S]*padding-right:\s*var\(--room-panel-width\)/);
  assert.match(layoutCss, /padding-right:\s*var\(--room-panel-width\)/);
  assert.match(controlsCss, /right:\s*var\(--room-panel-width\)/);
  assert.doesNotMatch(`${css}\n${layoutCss}\n${controlsCss}\n${friendsCss}`, /--(?:chat-rail|members-rail)-width/);
});


test('auth client does not mask unexpected backend failures as anonymous or empty state', () => {
  const authApi = read('src/lib/api/auth.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const signOut = read('src/lib/features/home/model/sign-out.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  assert.match(authApi, /throw new Error\('Не удалось проверить сессию'\)/);
  assert.match(authApi, /throw new Error\('Не удалось загрузить комнаты'\)/);
  assert.doesNotMatch(authApi, /if \(!response\.ok\) return null/);
  assert.doesNotMatch(authApi, /if \(!response\.ok\) return \[\]/);
  assert.match(home, /await signOut\(\);/);
  assert.match(signOut, /await logout\(\);\n\s+clearSession\(\);/);
  assert.match(home, /Не удалось выйти из аккаунта/);
  assert.match(lobby, /Не удалось загрузить комнаты/);
});

test('shared Select primitive wraps Popover listbox slots for site-wide dropdowns', () => {
  const select = read('src/lib/shared/ui/Select/Select.svelte');
  const sidebarDownload = read('src/lib/features/home/components/SidebarDownload.svelte');
  const settingsModal = read('src/lib/features/home/components/SettingsModal.svelte');
  const roomDock = read('src/lib/features/room/components/RoomDock.svelte');
  const devices = read('src/lib/features/room/client/ui/devices.ts');

  assert.match(select, /import \{ Popover \} from '\.\.\/Popover'/);
  assert.match(select, /\{flip\}/);
  assert.match(select, /\{#snippet trigger\(/);
  assert.match(select, /\{#snippet content\(/);
  assert.match(select, /role="option"/);
  assert.match(select, /onTriggerKeydown/);
  assert.match(select, /onOptionKeydown/);
  assert.match(select, /ArrowDown/);
  assert.match(select, /Home/);
  assert.match(select, /End/);
  assert.match(select, /typeahead/);
  assert.match(select, /event\.key === 'Tab'/);
  assert.match(select, /close\(false\)/);
  assert.match(select, /tabindex=\{index === activeIndex \? 0 : -1\}/);
  assert.match(select, /use:registerOption=\{index\}/);
  assert.doesNotMatch(select, /bind:this=\{optionRefs\[index\]\}/);
  assert.match(select, /\.select-trigger/);
  assert.match(sidebarDownload, /import \{[^}]*\bPopover\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(sidebarDownload, /import \{[^}]*\bPopoverMenuItem\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(settingsModal, /import \{[^}]*\bSelect\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(settingsModal, /import \{[^}]*\bSlider\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(settingsModal, /<Slider[\s\S]*onValueChange=\{onGateChange\}/);
  assert.match(settingsModal, /<span class="settings-field-label">Звуки интерфейса<\/span>[\s\S]*<Slider[\s\S]*onValueChange=\{onNotificationVolumeChange\}/);
  assert.match(settingsModal, /playPeerCue\('join'\)/);
  assert.match(settingsModal, /class="settings-sound-devices"[\s\S]*id="microphoneSettingsTitle"[\s\S]*id="speakerSettingsTitle"/);
  assert.match(settingsModal, /id="microphoneSettingsTitle"[\s\S]*Шумоподавление[\s\S]*Гейт[\s\S]*<\/section>[\s\S]*id="speakerSettingsTitle"[\s\S]*Звуки интерфейса/);
  assert.doesNotMatch(settingsModal, /settings-sound-processing/);
  assert.match(roomDock, /import \{[^}]*\bSelect\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(roomDock, /import \{[^}]*\bPopover\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.doesNotMatch(sidebarDownload, /<select\b/);
  assert.doesNotMatch(settingsModal, /<select\b/);
  assert.doesNotMatch(roomDock, /<select\b/);
  assert.doesNotMatch(devices, /deviceSelect|noiseModeSelect|outputDeviceSelect/);
});

test('popover placement flips vertically only when the preferred side would overflow', () => {
  const placement = read('src/lib/shared/ui/Popover/popover-placement.ts');

  assert.match(placement, /export function resolvePopoverPlacement/);
  assert.match(placement, /panelRect\.bottom > viewportHeight - margin/);
  assert.match(placement, /if \(spaceAbove > spaceBelow\) return flipPlacementVertical/);
});

test('shared Popover primitive exposes trigger/content slots and dismiss behavior', () => {
  const popover = read('src/lib/shared/ui/Popover/Popover.svelte');
  const popoverTypes = read('src/lib/shared/ui/Popover/types.ts');
  const popoverMenuItem = read('src/lib/shared/ui/Popover/PopoverMenuItem.svelte');
  const selectOption = read('src/lib/shared/ui/Select/Select.svelte');
  const sidebarDownload = read('src/lib/features/home/components/SidebarDownload.svelte');

  assert.match(popoverTypes, /trigger: Snippet<\[PopoverTriggerState\]>/);
  assert.match(popoverTypes, /content: Snippet<\[PopoverContentState\]>/);
  assert.match(popover, /\{@render trigger\(triggerState\)\}/);
  assert.match(popover, /\{@render content\(contentState\)\}/);
  assert.match(popover, /onpointerdown=\{onWindowPointerDown\}/);
  assert.match(popover, /requestClose\('escape'\)/);
  assert.match(popover, /script lang="ts" module/);
  assert.match(popover, /popoverPanelCounter/);
  assert.match(popover, /focusTrigger/);
  assert.match(popover, /onfocusout=\{onFocusOut\}/);
  assert.match(popover, /requestClose\('focusout', false\)/);
  assert.match(popover, /requestClose\('outside', false\)/);
  assert.match(popover, /data-placement=\{resolvedPlacement\}/);
  assert.match(popover, /resolvePopoverPlacement/);
  assert.match(popover, /openWithPlacement/);
  assert.match(popover, /flip = false/);
  assert.match(popover, /\.popover-panel/);
  assert.match(popoverMenuItem, /\.popover-menu-item/);
  assert.match(selectOption, /\.popover-option/);
  assert.match(sidebarDownload, /import \{[^}]*\bPopover\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(sidebarDownload, /\{#snippet trigger\(/);
  assert.match(sidebarDownload, /\{#snippet content\(/);
  assert.match(sidebarDownload, /aria-haspopup="menu"/);
});

test('room menus share one implementation while chat rows stay free of friend context menus', () => {
  const roomViewHeader = read('src/lib/features/home/components/lobby/RoomViewHeader.svelte');
  const roomTopbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const roomMenu = read('src/lib/shared/components/room-menu/RoomMenu.svelte');
  const roomMenuContent = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');
  const voiceHome = read('src/lib/features/home/components/lobby/VoiceHome.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const contextMenu = read('src/lib/shared/ui/ContextMenu/ContextMenu.svelte');
  const clipboard = read('src/lib/shared/utils/clipboard.ts');

  assert.match(roomViewHeader, /import \{ RoomMenu \} from '\$lib\/shared\/components\/room-menu'/);
  assert.match(roomTopbar, /import \{ RoomInviteFriendList, RoomMenu \} from '\$lib\/shared\/components\/room-menu'/);
  assert.match(roomViewHeader, /<RoomMenu[\s\S]*roomId=\{room\.roomId\}[\s\S]*avatarUrl=\{room\.avatarUrl\}/);
  assert.match(roomTopbar, /<RoomMenu[\s\S]*roomId=\{roomClientState\.roomId\}[\s\S]*avatarUrl=\{roomClientState\.roomAvatarUrl\}/);
  assert.match(roomMenu, /<Popover [^>]*role="menu"[^>]*ariaLabel="Меню комнаты"/);
  assert.match(roomMenu, /<RoomMenuContent[\s\S]*\{roomId\}[\s\S]*\{name\}[\s\S]*\{avatarUrl\}/);
  assert.match(roomMenu, /canClose=\{\(targetRoomId\) => targetRoomId === roomId\}/);
  assert.match(roomMenuContent, /onOpenSettings|Настройки комнаты/);
  assert.match(roomViewHeader, /onOpenSettings/);
  assert.match(roomTopbar, /onOpenSettings=\{roomSettingsUi\.isOwner \? openRoomSettings : undefined\}/);
  assert.doesNotMatch(roomTopbar, /title="Настройки комнаты" onclick=\{handleOpenSettings\}/);
  assert.match(roomMenuContent, /data-room-menu-content/);

  assert.match(voiceHome, /oncontextmenu=\{\(event\) => openRoomContextMenu\(event, room\.roomId\)\}/);
  assert.match(voiceHome, /event\.key === 'ContextMenu' \|\| \(event\.key === 'F10' && event\.shiftKey\)/);
  assert.match(voiceHome, /<ContextMenu[\s\S]*<RoomMenuContent/);
  assert.match(voiceHome, /canClose=\{\(roomId\) => contextRoomId === roomId\}/);
  assert.match(voiceHome, /relationship=\{contextRoom\.relationship\}/);
  assert.match(roomMenuContent, /label=\{roomMuted \? 'Включить уведомления' : 'Выключить уведомления'\}/);
  assert.match(roomMenuContent, /isOwner && onOpenSettings/);
  assert.match(roomMenuContent, /!isOwner[\s\S]*label="Удалить из списка"/);
  assert.doesNotMatch(sidebar, /openFriendContextMenu|FriendMenuContent|oncontextmenu/);
  assert.match(clipboard, /if \(!navigator\.clipboard\?\.writeText\)/);
  assert.match(clipboard, /throw new Error\('Clipboard API is unavailable'\)/);

  assert.match(contextMenu, /position:\s*fixed/);
  assert.match(contextMenu, /window\.innerWidth - rect\.width - EDGE_GAP/);
  assert.match(contextMenu, /window\.innerHeight - rect\.height - EDGE_GAP/);
  assert.match(contextMenu, /event\.key === 'Escape'/);
  assert.match(contextMenu, /event\.key === 'ArrowDown'/);
  assert.match(contextMenu, /queueMicrotask\(\(\) => restoreFocus\?\.focus\(\)\)/);
  assert.match(contextMenu, /window\.addEventListener\('resize', handleViewportChange\)/);
  assert.match(contextMenu, /window\.addEventListener\('scroll', handleViewportScroll/);
  assert.match(contextMenu, /isInsideOwnedOverlay\(event\.target\)/);
  assert.match(contextMenu, /max-height: calc\(100dvh - 16px\)/);
  assert.match(contextMenu, /overflow-y: auto/);
});

test('room and participant avatars preserve fallbacks while preferring uploaded images and accents', () => {
  const authApi = read('src/lib/api/auth.ts');
  const roomsApi = read('src/lib/api/rooms.ts');
  const settingsModal = read('src/lib/features/home/components/SettingsModal.svelte');
  const voiceHome = read('src/lib/features/home/components/lobby/VoiceHome.svelte');
  const createDialog = read('src/lib/features/home/components/CreateRoomDialog.svelte');
  const participantTile = read('src/lib/features/room/components/ParticipantTile.svelte');
  const chat = readRoomChat();
  const roomNet = read('src/lib/features/room/client/net/api.ts');
  const roomTopbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const roomMenu = read('src/lib/shared/components/room-menu/RoomMenu.svelte');
  const notificationRouter = read('src/lib/shared/notifications/router.ts');

  assert.match(authApi, /avatarColorKey: string/);
  assert.match(roomsApi, /avatarColorKey: string/);
  assert.doesNotMatch(authApi, /roomIconKey|roomColorKey|roomPresetKey|emoji/);
  assert.doesNotMatch(roomsApi, /roomIconKey|roomColorKey|roomPresetKey|emoji/);
  assert.match(settingsModal, /src=\{avatarPreviewUrl \|\| \(removeAvatarPending \? null : user\?\.avatarUrl\)\}/);
  assert.match(settingsModal, /background=\{user\?\.avatarAccent \|\| undefined\}/);
  assert.match(voiceHome, /<Avatar name=\{roomDisplayName\(room\)\} src=\{room\.avatarUrl\} shape="squircle" background="var\(--room-avatar-bg\)"/);
  assert.doesNotMatch(createDialog, /ROOM_PRESETS|roomPresetKey|roomIconKey|roomColorKey/);
  assert.match(participantTile, /getAvatarPresentation\(participant\)/);
  assert.match(chat, /getAvatarPresentation\(\{/);
  assert.match(chat, /avatarUrl: message\.avatarUrl \|\| undefined/);
  assert.doesNotMatch(roomNet, /roomIconKey|roomColorKey|roomPresetKey|emoji/);
  assert.match(roomTopbar, /avatarUrl=\{roomClientState\.roomAvatarUrl\}/);
  assert.match(roomMenu, /<Avatar \{name\} src=\{avatarUrl\} shape="squircle" background="var\(--room-avatar-bg\)"/);
  assert.doesNotMatch(roomTopbar, /getRoomPreset|roomVisual|emoji/);
  assert.match(notificationRouter, /avatarAccent\?: string \| null/);
  assert.match(notificationRouter, /avatarUrl\?: string \| null/);
  assert.doesNotMatch(notificationRouter, /NotificationRoomContext[\s\S]*avatarColorKey/);
});

test('release 2.4 follow-up keeps room actions in the room menu and fits call tiles to the stage', () => {
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const roomMenu = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');
  const stageLayout = read('src/lib/features/room/styles/stage-layout.css') + read('src/lib/features/room/styles/participants.css');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');

  assert.doesNotMatch(topbar, /class="room-chat-toggle"[^>]*title="Настройки комнаты"/);
  assert.match(roomMenu, /label="Настройки комнаты"/);
  assert.match(roomMenu, /<PopoverSubmenu label="Пригласить"/);
  assert.match(stageLayout, /--grid-aspect:/);
  assert.match(stageLayout, /100cqh/);
  assert.match(sidebar, /class="lv-profile-actions"/);
});

test('room rings render as shared timeline invitations carried by DMs', () => {
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  const dmApi = read('src/lib/api/dm.ts');

  // Invitations live inside the DM thread (server metadata), not in a
  // per-device local list, so both participants see the same timeline.
  assert.doesNotMatch(friends, /roomInvitations: RoomInvitation\[\]/);
  assert.doesNotMatch(friends, /persistResolvedRoomInvitations/);
  assert.match(friends, /respondRoomInvitation/);
  assert.doesNotMatch(friends, /const ringToastIds/);
  assert.doesNotMatch(friends, /pushToast\(`\$\{senderName\} зовёт/);
  assert.match(dmApi, /invite\?: DirectMessageInvite \| null/);
  assert.match(dmApi, /metadata\.kind === 'room-invite'/);
  assert.match(dmApi, /\/invites\/\$\{encodeURIComponent\(messageId\)\}\/respond/);
  assert.match(dmView, /bubble\.invite/);
  assert.match(dmView, /lobby-room-invitation/);
  assert.match(dmView, />Войти<\/button>/);
});

test('avatar crop and settings flows export a normalized bitmap and refresh live user and room state', () => {
  const crop = read('src/lib/shared/ui/AvatarCropDialog/AvatarCropDialog.svelte');
  const authApi = read('src/lib/api/auth.ts');
  const roomsApi = read('src/lib/api/rooms.ts');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const roomSettings = read('src/lib/features/room/components/RoomSettingsDialog.svelte');

  assert.match(crop, /output\.width = 256/);
  assert.match(crop, /output\.height = 256/);
  assert.match(crop, /output\.toBlob\(/);
  assert.match(crop, /onpointerdown=\{onPointerDown\}/);
  assert.match(crop, /onwheel=\{onWheel\}/);
  assert.match(crop, /event\.preventDefault\(\)[\s\S]*Math\.max\(1, Math\.min\(3, zoom/);
  assert.match(crop, /bind:value=\{zoom\}/);
  assert.match(crop, /shape === 'circle'/);
  assert.match(crop, /shape === 'squircle'/);
  assert.match(crop, /deriveAvatarAccent/);
  assert.match(crop, /image = null/);
  assert.match(crop, /previewUrl = ''/);
  assert.match(crop, /reader\.abort\(\)/);
  assert.doesNotMatch(crop, /URL\.createObjectURL/);

  assert.match(authApi, /uploadUserAvatar/);
  assert.match(authApi, /deleteUserAvatar/);
  assert.match(roomsApi, /uploadRoomAvatar/);
  assert.match(roomsApi, /deleteRoomAvatar/);
  assert.match(settings, /import \{[^}]*\buntrack\b[^}]*\} from 'svelte'/);
  assert.match(settings, /untrack\(\(\) => \{[\s\S]*pendingAvatar = null/);
  assert.match(settings, /pendingAvatar = blob/);
  assert.match(settings, /const avatarBlob = pendingAvatar[\s\S]*if \(avatarBlob\)[\s\S]*await uploadUserAvatar\(avatarBlob\)/);
  assert.match(settings, /removeAvatarPending = true/);
  assert.match(settings, /const shouldRemoveAvatar = removeAvatarPending[\s\S]*else if \(shouldRemoveAvatar\)[\s\S]*await deleteUserAvatar\(\)/);
  assert.match(roomSettings, /applyRoomUpdated\(room\)/);
  assert.match(roomSettings, /voice-room:rooms-changed/);
  assert.match(roomSettings, /settings-modal room-settings-modal/);
  assert.match(roomSettings, /settings-content room-settings-content/);
});

test('connection status renders reactively from room state, not imperative DOM writes', () => {
  const status = read('src/lib/features/room/client/ui/status.ts');
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const dock = read('src/lib/features/room/components/RoomDock.svelte');

  // status.ts is a pure derivation over reactive state — no DOM writes or refresh hooks.
  assert.match(status, /export function getConnectionStatusView\(\): ConnectionStatusView/);
  assert.doesNotMatch(status, /elements\.|setStatus|renderConnectionStatus|refreshLocalNetworkIndicator/);

  // Pill (topbar) and signal bars (dock) both subscribe via $derived.
  assert.match(topbar, /const connection = \$derived\(getConnectionStatusView\(\)\)/);
  assert.match(topbar, /data-state=\{connection\.stateName\}/);
  assert.match(topbar, /hidden=\{connection\.stateName === 'idle' \|\| roomClientState\.screen !== 'room'\}/);
  assert.match(dock, /const connection = \$derived\(getConnectionStatusView\(\)\)/);
  assert.match(dock, /data-state=\{connection\.stateName\}/);

  // The imperative element cache is gone — screens and controls render in Svelte.
  assert.equal(existsSync(resolve(root, 'src/lib/features/room/client/ui/dom.ts')), false);
});



test('local participant updates do not remove the self tile when LiveKit mute events resync', () => {
  const participants = read('src/lib/features/room/client/room/participants.ts');

  assert.match(participants, /const duplicate = state\.peers\.get\(peerInfo\.id\)/);
  assert.match(participants, /if \(duplicate\) state\.peers\.delete\(duplicate\.id\)/);
  assert.doesNotMatch(participants, /removeParticipantView/);
});

test('participant tiles stay visually uniform and highlight only active speakers', () => {
  const css = read('src/lib/features/room/styles/participants.css');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const participantTile = read('src/lib/features/room/components/ParticipantTile.svelte');
  const meters = read('src/lib/features/room/client/media/meters.ts');
  const livekit = read('src/lib/features/room/client/services/livekit-service.ts');
  const stats = read('src/lib/features/room/client/room/stats.ts');
  const controls = read('src/lib/features/room/client/ui/controls.ts');

  assert.match(css, /\.participant\[data-speaking="true"\]/);
  assert.match(css, /border-color: var\(--green\)/);
  assert.match(css, /\.participant\[data-speaking="true"\] \.voice-ring/);
  assert.doesNotMatch(css, /\.participant\[data-local="true"\]\s*\{\s*border-color/s);
  assert.match(participants, /participant\.speaking = nextSpeaking/);
  assert.match(participants, /refreshParticipantState\(\)/);
  assert.match(participants, /bumpParticipantsRevision\(\)/);
  assert.match(participantTile, /data-speaking=\{String\(participant\.speaking\)\}/);
  // Every ring is driven by this tab's own analyser, so it lights on the frame
  // the audio arrives instead of waiting for the SFU's sampled speaker list.
  assert.match(meters, /applySpeaking\(participant, isOverSpeakingThreshold\(participant, levelDb\)\)/);
  assert.match(meters, /if \(!participant\.isLocal\) return levelDb >= REMOTE_SPEAKING_DB/);
  assert.match(meters, /participant\.speaking = speaking/);
  assert.match(meters, /bumpParticipantsRevision\(\)/);
  // Deafened must not leave a ring standing: nothing is reaching this tab.
  assert.match(meters, /if \(state\.outputMuted\) return false/);
  assert.match(controls, /if \(state\.outputMuted\) clearAllSpeaking\(\)/);
  assert.match(participants, /export function clearAllSpeaking\(\)/);
  // The server view stays a fallback for peers whose analyser is not up yet.
  assert.match(livekit, /RoomEvent\.ActiveSpeakersChanged/);
  assert.match(livekit, /if \(peer\.analyser\) continue;/);
  assert.match(stats, /if \(peer\.analyser\) continue;/);
});

test('screen share publish tuning applies codec, bitrate, degradation and contentHint contracts', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const profiles = read('src/lib/features/room/client/media/profiles.ts');
  const capture = read('src/lib/features/room/client/services/screen-capture-service.ts');
  const screenShare = read('src/lib/features/room/client/services/screen-share-service.ts');
  const livekit = read('src/lib/features/room/client/services/livekit-service.ts');

  assert.doesNotMatch(config, /low:/);
  assert.match(config, /balanced:[\s\S]*15: 3_000_000[\s\S]*30: 5_000_000/);
  assert.match(config, /high:[\s\S]*15: 4_000_000[\s\S]*30: 7_000_000/);
  assert.match(config, /source:[\s\S]*5: 1_800_000[\s\S]*source: true/);
  assert.doesNotMatch(config, /60:[\s\S]*contentHint: 'motion'[\s\S]*frameRate: 60/);
  assert.match(config, /SCREEN_SIMULCAST_LAYER = \{[\s\S]*height: 540[\s\S]*width: 960[\s\S]*5: 500_000[\s\S]*30: 1_500_000/);
  assert.match(profiles, /return 'h264'/);
  assert.match(profiles, /return 'vp9'/);
  assert.match(profiles, /return 'vp8'/);
  assert.match(profiles, /getScreenDegradationPreference/);
  assert.match(capture, /videoTrack\.contentHint = profile\.contentHint/);
  assert.doesNotMatch(capture, /&& !videoTrack\.contentHint/);
  assert.match(capture, /frameRate: \{ ideal: profile\.frameRate, max: profile\.frameRate \}/);
  assert.match(capture, /constraints\.height = \{ ideal: profile\.height, max: profile\.height \}/);
  assert.match(capture, /constraints\.width = \{ ideal: profile\.width, max: profile\.width \}/);
  assert.match(capture, /openDesktopDisplayMediaStream\(sourceId, withAudio, audioMode, profile\)/);
  assert.match(
    capture,
    /selectSource\(sourceId,[\s\S]*mode: audioMode[\s\S]*fpsId: profile\.fpsId,[\s\S]*qualityId: profile\.qualityId/
  );
  assert.match(screenShare, /await publishLocalScreenTracks\(\);[\s\S]*await applyLocalScreenEncodingProfile\(profile\)/);
  assert.match(screenShare, /if \(!parameters\.encodings\?\.length\) parameters\.encodings = \[\{\}\]/);
  assert.match(screenShare, /primaryEncoding\.maxBitrate = profile\.videoBitrate/);
  assert.match(screenShare, /parameters\.degradationPreference = degradationPreference/);
  assert.match(screenShare, /encoderImplementation/);
  assert.match(screenShare, /capturePixelFormat: captureStats\.capturePixelFormat/);
  assert.match(screenShare, /snapshot\.pixelFormat === 'NV12'/);
  assert.match(screenShare, /snapshot\.relay\?\.framesDroppedBackpressure/);
  assert.doesNotMatch(screenShare, /Сеть просела|Сеть стабильна/);
  assert.doesNotMatch(screenShare, /adaptLocalScreenProfile|setLocalScreenProfile|getLocalScreenStatsHealth/);
  assert.doesNotMatch(screenShare, /applyScreenCaptureProfile/);
  assert.doesNotMatch(screenShare, /options\.toast/);
  assert.match(livekit, /adaptiveStream: false/);
});

test('screen share keeps the selected capture profile stable while libwebrtc owns congestion response', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const profiles = read('src/lib/features/room/client/media/profiles.ts');
  const state = read('src/lib/features/room/client/model/room-state.ts');
  const screenShare = read('src/lib/features/room/client/services/screen-share-service.ts');
  const types = read('src/lib/features/room/client/core/types.ts');
  const updateStats = functionBody(screenShare, 'updateLocalScreenStats');

  assert.doesNotMatch(config, /SCREEN_ADAPT_/);
  assert.doesNotMatch(profiles, /getScreenProfileRank|getLowerScreenProfileId|getHigherScreenProfileId/);
  assert.doesNotMatch(state, /localScreenAdapt|localScreenTargetProfileId/);
  assert.doesNotMatch(types, /localScreenAdapt|localScreenTargetProfileId/);
  assert.doesNotMatch(screenShare, /adaptLocalScreenProfile|setLocalScreenProfile|getLocalScreenStatsHealth/);
  assert.doesNotMatch(updateStats, /applyScreenCaptureProfile|applyLocalScreenEncodingProfile/);
  assert.match(screenShare, /startLocalScreenStatsMonitor\(\)/);
  assert.match(screenShare, /primaryEncoding\.maxBitrate = profile\.videoBitrate/);
  assert.match(screenShare, /primaryEncoding\.maxFramerate = profile\.frameRate/);
});

test('screen share quality contract exposes Discord-like source text and game modes', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const profiles = read('src/lib/features/room/client/media/profiles.ts');
  const state = read('src/lib/features/room/client/model/room-state.ts');
  const screenShare = read('src/lib/features/room/client/services/screen-share-service.ts');
  const capture = read('src/lib/features/room/client/services/screen-capture-service.ts');
  const types = read('src/lib/features/room/client/core/types.ts');
  const dock = read('src/lib/features/room/components/RoomDock.svelte');
  const overlays = read('src/lib/features/room/components/RoomOverlays.svelte');
  const picker = read('src/lib/features/room/client/ui/screen-source-picker.ts');
  const sourceUi = read('src/lib/features/room/screen-source-ui.svelte.ts');
  const controls = read('src/lib/features/room/styles/controls.css');
  const overlayStyles = read('src/lib/features/room/styles/overlays.css');

  assert.match(config, /DEFAULT_SCREEN_STREAM_MODE = 'games'/);
  assert.match(config, /SCREEN_STREAM_MODE_PROFILES = \{[\s\S]*games: 'balanced-30'[\s\S]*text: 'source-5'/);
  assert.match(config, /balanced:[\s\S]*5: 1_200_000[\s\S]*15: 3_000_000/);
  assert.match(config, /high:[\s\S]*5: 1_800_000[\s\S]*15: 4_000_000/);
  assert.match(config, /source:[\s\S]*5: 1_800_000[\s\S]*label: 'Источник'/);
  assert.doesNotMatch(config, /low:/);
  assert.match(profiles, /export function getScreenProfileForMode/);
  assert.match(profiles, /export function getScreenModeSummary/);
  assert.match(state, /localScreenMode: DEFAULT_SCREEN_STREAM_MODE/);
  assert.match(screenShare, /export function getSelectedScreenProfileId/);
  assert.doesNotMatch(screenShare, /export function getScreenStreamModeView/);
  assert.doesNotMatch(screenShare, /export async function selectScreenStreamMode/);
  assert.doesNotMatch(screenShare, /export async function setCustomScreenQuality/);
  assert.doesNotMatch(screenShare, /export async function setCustomScreenFps/);
  assert.match(screenShare, /state\.localScreenProfileId = profile\.id/);
  assert.doesNotMatch(dock, /screenMenuButton/);
  assert.match(sourceUi, /mode: 'games' as 'games' \| 'text'/);
  assert.match(sourceUi, /quality: 'balanced' as 'balanced' \| 'high'/);
  assert.match(sourceUi, /selectedSourceId: null as string \| null/);
  assert.match(types, /export interface ScreenSourceSelection extends DesktopPickerSelection/);
  assert.match(types, /mode: ScreenStreamMode/);
  assert.match(types, /source: DesktopCaptureSource/);
  assert.match(picker, /export function confirmScreenSourcePicker/);
  assert.match(picker, /screenSourceUi\.mode === 'text' \? 'source' : screenSourceUi\.quality/);
  assert.match(picker, /createScreenProfileId\(qualityId, fpsId\)/);
  assert.match(picker, /mode: screenSourceUi\.mode/);
  assert.match(picker, /streamAudioEnabled: screenSourceUi\.audio/);
  assert.doesNotMatch(picker, /state\.localScreenMode = screenSourceUi\.mode/);
  assert.doesNotMatch(picker, /state\.localScreenProfileId = profileId/);
  assert.match(screenShare, /const mode = capture\.mode \|\| getScreenModeForProfile\(profile\.id\)/);
  assert.match(capture, /const selectedProfile = getDesktopPickerProfile\(selection, profile\)/);
  assert.match(capture, /const withAudio = selection\.streamAudioEnabled === true/);
  assert.match(capture, /openDesktopStream\(source\.id, selectedProfile/);
  assert.match(capture, /return \{ mode: selection\.mode, profile: selectedProfile, stream \}/);
  assert.match(capture, /SCREEN_QUALITY_OPTIONS\[profile\.qualityId\]\?\.source/);
  assert.match(overlays, /Режим стрима/);
  assert.match(overlays, /Плавное видео/);
  assert.match(overlays, /Чёткая картинка/);
  assert.match(overlays, /screenSourceUi\.mode = 'games'/);
  assert.match(overlays, /screenSourceUi\.mode = 'text'/);
  assert.match(overlays, /onclick=\{confirmScreenSourcePicker\}/);
  assert.doesNotMatch(controls, /\.screen-mode-option/);
  assert.match(overlayStyles, /\.screen-source-pop-preset/);
  assert.match(overlays, /screenSourceUi\.mode === 'games'/);
  assert.match(overlays, /Источник/);
  assert.match(overlayStyles, /\.screen-source-res-btn\[aria-pressed="true"\]/);
});

test('screen stream thumbnails show profile metadata instead of an action button', () => {
  const overlays = read('src/lib/features/room/components/RoomOverlays.svelte');
  const screenStageControls = read('src/lib/features/room/client/ui/screen-stage-controls.ts');
  const refs = read('src/lib/features/room/client/model/participants.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const streamTile = read('src/lib/features/room/components/StreamTile.svelte');
  const screenView = read('src/lib/features/room/client/ui/screen-view.ts');
  const participantsCss = read('src/lib/features/room/styles/participants.css');
  const streamTilesCss = read('src/lib/features/room/styles/stream-tiles.css');

  assert.doesNotMatch(overlays, /participant-screen-meta/);
  assert.doesNotMatch(refs, /screenMeta: HTMLElement/);
  assert.doesNotMatch(participants, /refreshParticipantScreenMeta/);
  const participantTile = read('src/lib/features/room/components/ParticipantTile.svelte');
  assert.match(participantTile, /handleTileClick/);
  assert.match(participantTile, /enterScreenView\(participant\.id\)/);
  assert.match(participantsCss, /\.participant\[data-screen="true"\] \.participant-screen-action\s*\{\s*display: none;/s);
  assert.match(streamTile, /stream-tile-profile-meta/);
  assert.match(streamTile, /getScreenProfileLabels/);
  assert.doesNotMatch(streamTile, /stream-tile-action-disconnect/);
  assert.doesNotMatch(streamTile, /Отключиться/);
  assert.match(streamTile, /participant\.isLocal \? roomState\.localScreenProfileId : participant\.screenProfileId/);
  assert.match(streamTilesCss, /\.stream-tile-profile-meta/);
  assert.doesNotMatch(streamTilesCss, /stream-tile-action-disconnect/);
});

test('participant audio controls precede moderation actions and screen metadata stays user-facing', () => {
  const participantMenu = read('src/lib/features/room/components/ParticipantContextMenu.svelte');
  const screenUi = read('src/lib/features/room/screen-ui.svelte.ts');
  const screenStage = read('src/lib/features/room/components/ScreenStage.svelte');

  assert.match(participantMenu, /<span>Громкость<\/span>[\s\S]*Заглушить[\s\S]*Исключить[\s\S]*Заблокировать/);
  assert.match(screenUi, /const \{ qualityLabel, fpsLabel \} = getScreenProfileLabels\(profileId\)/);
  assert.doesNotMatch(screenUi, /captureLabel|getScreenCaptureLabel|энкодер:/);
  assert.match(screenStage, /id="screenMetaQuality">\{meta\.qualityLabel\}/);
  assert.match(screenStage, /id="screenMetaFps">\{meta\.fpsLabel\}/);
  assert.doesNotMatch(screenStage, /screenMetaCapture|showCapture/);
});

test('audio unlock fallback button defers to the stream watch gate', () => {
  const playback = read('src/lib/features/room/client/services/media-playback-service.ts');
  const roomMain = read('src/lib/features/room/client/main.ts');

  // The "Смотреть стрим" click is the unlock gesture: while an unwatched
  // remote stream is on screen, the fallback sound button must stay hidden.
  assert.match(playback, /options\.showFallback && !hasPendingStreamWatchGate\(\)/);
  assert.match(playback, /function hasPendingStreamWatchGate\(\)/);
  assert.match(playback, /state\.viewedScreenPeerId === peer\.id \|\| state\.screenSubscribedPeerIds\.has\(peer\.id\)/);
  assert.match(roomMain, /document\.addEventListener\('pointerdown', handleAudioUnlockGesture/);
});

test('screen stage and lobby room previews use shared AvatarStack for participant avatars', () => {
  const stage = read('src/lib/features/room/components/ScreenStage.svelte');
  const screenUi = read('src/lib/features/room/screen-ui.svelte.ts');
  const avatarStack = read('src/lib/shared/ui/AvatarStack/AvatarStack.svelte');
  const uiIndex = read('src/lib/shared/ui/index.ts');
  const browseView = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');
  const previewView = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  assert.match(uiIndex, /export \{ AvatarStack \} from '\.\/AvatarStack'/);
  assert.match(avatarStack, /maxAvatars/);
  assert.match(avatarStack, /avatar-stack-rest/);
  assert.match(stage, /<AvatarStack items=\{meta\.viewerAvatars\} maxAvatars=\{null\}/);
  assert.match(screenUi, /getViewerAvatarItem/);
  assert.match(screenUi, /viewerAvatars: viewers\.map\(getViewerAvatarItem\)/);
  assert.match(screenUi, /getAvatarPresentation\(viewer\)/);
  // The room preview header shows no live badge: the stage itself is the roster.
  assert.doesNotMatch(browseView, /AvatarStack/);
  assert.doesNotMatch(previewView, /AvatarStack/);
  assert.match(lobby, /decrementRoomPeerCount/);
  assert.match(lobby, /setRoomPeerCount\(roomId, Math\.max\(0, current - 1\)\)/);
  assert.match(lobby, /initLobbyRoomRealtime/);
  assert.match(browseView, /subscribeRoomPreview/);
  assert.match(previewView, /subscribeRoomPreview/);
  assert.doesNotMatch(screenUi, /screen-meta-viewers-label/);
  assert.doesNotMatch(screenUi, /formatScreenViewersLine/);
  assert.doesNotMatch(screenUi, /names\.join/);
});

test('room route uses lobby for authenticated users and preserves standalone guest entry', () => {
  const roomRoute = read('src/routes/r/[roomId]/+page.svelte');
  const roomRouteOptions = read('src/routes/r/[roomId]/+page.ts');
  const roomPage = read('src/lib/features/room/RoomPage.svelte');
  const roomMain = read('src/lib/features/room/client/main.ts');
  const roomView = read('src/lib/features/room/client/room/room.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const names = read('src/lib/features/room/client/ui/names.ts');
  const overlays = read('src/lib/features/room/components/RoomOverlays.svelte');
  const screenStageControls = read('src/lib/features/room/client/ui/screen-stage-controls.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const showRoomRoute = functionBody(roomView, 'showRoomRoute');
  const resolveRoomEntryName = functionBody(roomView, 'resolveRoomEntryName');
  const requestGuestNameForRoom = functionBody(names, 'requestGuestNameForRoom');
  const handleGuestNameSubmit = functionBody(names, 'handleGuestNameSubmit');

  assert.match(roomRoute, /import RoomPage from '\$lib\/features\/room\/RoomPage\.svelte'/);
  assert.match(roomRoute, /import LobbyPage from '\$lib\/features\/home\/LobbyPage\.svelte'/);
  assert.match(roomRoute, /loadSession\(\)/);
  assert.match(roomRoute, /session\.user/);
  assert.match(roomRoute, /<LobbyPage user=\{session\.user\}/);
  assert.match(roomRoute, /\{#key routeRoomId\}[\s\S]*<RoomPage roomId=\{routeRoomId\} autoJoin \/>[\s\S]*\{\/key\}/);
  assert.match(roomRouteOptions, /export const ssr = false/);
  assert.match(roomPage, /roomId = ''/);
  assert.match(roomPage, /autoJoin = false/);
  assert.match(roomPage, /mountRoomClient\(roomRoot, \{ roomId: embeddedRoomId \|\| roomId, embeddedRoomId, autoJoin \}\)/);
  assert.match(roomMain, /const mountedRoomId = options\.roomId \|\| options\.embeddedRoomId \|\| ''/);
  assert.match(roomMain, /state\.roomId = mountedRoomId/);
  assert.match(roomMain, /if \(ready && options\.autoJoin\) return joinRoom\(\)/);
  assert.match(roomMain, /showRoomRoute\(\)/);
  assert.match(roomMain, /showStartScreen\(\)/);
  assert.match(roomMain, /resetGuestNameDialog/);
  assert.doesNotMatch(roomMain, /bindGuestNameDialog|unbindGuestNameDialog|setElementsRoot|elements\./);
  assert.match(roomMain, /new AbortController\(\)/);
  assert.match(roomMain, /listenerSignal/);
  assert.match(roomMain, /mountAbortController\?\.abort\(\)/);
  assert.match(roomMain, /bindScreenStageIdleUi\(listenerSignal\)/);
  assert.match(roomMain, /mounted = false/);
  assert.doesNotMatch(roomRoute, /HomePage/);
  assert.doesNotMatch(roomPage, /loadSession|authLoadError|LobbyPage/);
  assert.match(home, /auth-session-error/);
  assert.match(roomRoute, /Не удалось проверить аккаунт/);
  assert.match(roomRoute, /features\/home\/styles\/home\.css/);

  assert.match(roomView, /import \{ addRoomByCode, fetchMe, fetchOwnedRooms \} from '\$lib\/api\/auth'/);
  assert.match(roomView, /import \{ session, setUser \} from '\$lib\/features\/auth\/session\.svelte'/);
  assert.match(roomView, /import \{ roomNameFor \} from '\$lib\/features\/auth\/account'/);
  assert.match(roomView, /type RoomEntryGateResult = 'authenticated' \| 'anonymous' \| 'failure'/);
  assert.match(showRoomRoute, /const exists = await checkRoomExists\(state\.roomId\)/);
  assert.ok(showRoomRoute.indexOf('showRoomNotFound()') < showRoomRoute.indexOf('resolveRoomEntryName()'));
  assert.match(showRoomRoute, /return false/);
  assert.match(showRoomRoute, /const entryGate = await resolveRoomEntryName\(\)/);
  assert.match(showRoomRoute, /if \(entryGate === 'failure'\) \{[\s\S]*showRoomEntryFailure\(\);[\s\S]*return false;[\s\S]*\}/);
  assert.ok(showRoomRoute.indexOf('resolveRoomEntryName()') < showRoomRoute.indexOf('showRoomScreen()'));
  assert.match(showRoomRoute, /return true/);
  assert.match(resolveRoomEntryName, /const user = await fetchMe\(\)/);
  assert.match(resolveRoomEntryName, /setUser\(user\)/);
  assert.ok(resolveRoomEntryName.indexOf('setUser(user)') < resolveRoomEntryName.indexOf('persistName(roomNameFor(user))'));
  assert.match(resolveRoomEntryName, /persistName\(roomNameFor\(user\)\)/);
  assert.match(resolveRoomEntryName, /void autoSaveRoomForAuthenticatedUser\(state\.roomId\)/);
  assert.ok(resolveRoomEntryName.indexOf('void autoSaveRoomForAuthenticatedUser(state.roomId)') < resolveRoomEntryName.indexOf("return 'authenticated'"));
  assert.match(resolveRoomEntryName, /return 'authenticated'/);
  assert.match(resolveRoomEntryName, /return 'failure'/);
  assert.match(resolveRoomEntryName, /await requestGuestNameForRoom\(\)/);
  assert.match(resolveRoomEntryName, /Guest name request cancelled/);
  assert.match(resolveRoomEntryName, /return 'anonymous'/);
  assert.doesNotMatch(resolveRoomEntryName, /loadSession|showRoomScreen|autoJoinRoom|showRoomNotFound/);
  assert.match(roomView, /async function autoSaveRoomForAuthenticatedUser\(roomId: string\): Promise<void>/);
  assert.match(roomView, /await addRoomByCode\(roomId\)/);
  assert.match(roomView, /window\.dispatchEvent\(new CustomEvent\('voice-room:rooms-changed'/);
  assert.match(roomView, /console\.debug\('Room auto-save skipped'/);
  assert.match(lobby, /window\.addEventListener\('voice-room:rooms-changed', onRoomsChanged\)/);
  assert.match(lobby, /window\.removeEventListener\('voice-room:rooms-changed', onRoomsChanged\)/);
  assert.match(functionBody(lobby, 'onRoomsChanged'), /void refreshRooms\(\)/);
  assert.doesNotMatch(roomView, /window\.prompt|prompt\(/);
  assert.doesNotMatch(roomView, /loadSession/);

  assert.match(overlays, /id="guestNameDialog"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(overlays, /id="guestNameForm"/);
  assert.match(overlays, /id="guestNameInput"/);
  assert.doesNotMatch(overlays, /id="guestNameInput"[^>]*required/);
  assert.match(overlays, /id="guestNameError"/);
  assert.match(overlays, /id="guestNameSubmitButton"[\s\S]*type="submit"/);
  assert.doesNotMatch(overlays, /guestNameClose|guest-name-close|Отмена|Закрыть/);
  assert.equal(existsSync(resolve(root, 'src/lib/features/room/client/ui/dom.ts')), false);
  assert.match(overlays, /guestNameUi\.open/);
  assert.match(overlays, /bind:value=\{guestNameUi\.inputValue\}/);
  assert.match(names, /pendingGuestNamePromise/);
  assert.match(screenStageControls, /bindScreenStageIdleUi\(signal\?: AbortSignal\)/);
  assert.match(screenStageControls, /resetScreenStageIdleUi/);
  assert.match(screenStageControls, /screenUiHoverBound = false/);
  assert.match(screenStageControls, /signal\?\.addEventListener\('abort'/);
  assert.match(names, /resetGuestNameDialog/);
  assert.match(names, /rejectPendingGuestName/);
  assert.match(names, /guestNameUi/);
  assert.doesNotMatch(names, /unbindGuestNameDialog|elements\.guestName/);
  assert.match(names, /syncGuestNameDialogInert/);
  assert.match(names, /handleGuestNameDialogKeydown/);
  assert.match(names, /handleGuestNameDialogClick/);
  assert.match(overlays, /syncGuestNameDialogInert/);
  assert.match(overlays, /handleGuestNameDialogKeydown/);
  assert.match(overlays, /handleGuestNameDialogClick/);
  assert.match(requestGuestNameForRoom, /setGuestNameDialogOpen\(true\)/);
  assert.match(requestGuestNameForRoom, /guestNameUi\.inputValue = ''/);
  assert.match(handleGuestNameSubmit, /cleanDisplayName\(guestNameUi\.inputValue\)/);
  assert.match(handleGuestNameSubmit, /Введите имя, чтобы войти в комнату/);
  assert.match(handleGuestNameSubmit, /persistName\(name\)/);
  assert.ok(handleGuestNameSubmit.indexOf('persistName(name)') < handleGuestNameSubmit.indexOf('setGuestNameDialogOpen(false)'));
});

test('anonymous quick-start and join-by-code stay independent from account APIs', () => {
  const home = read('src/lib/features/home/HomePage.svelte');
  const landingHero = read('src/lib/features/home/components/LandingHero.svelte');
  const roomsApi = read('src/lib/api/rooms.ts');
  const authApi = read('src/lib/api/auth.ts');

  assert.match(home, /<LandingHero[\s\S]*onCreateTemp=\{handleCreateTemp\}[\s\S]*onJoin=\{handleJoinRoom\}/);
  assert.match(home, /const showLobby = \$derived\(session\.loaded && Boolean\(user\)\)/);
  assert.match(home, /function handleJoinRoom\(\): void[\s\S]*openRoom\(roomId\)/);
  assert.match(home, /async function handleCreateTemp\(\): Promise<void>[\s\S]*createRoom\(\{ isStatic: false \}\)/);
  assert.match(landingHero, /Без имени и регистрации/);
  assert.match(landingHero, /Код комнаты/);
  assert.match(roomsApi, /postJson<CreateRoomResponse>\('\/api\/rooms'/);
  assert.match(roomsApi, /isStatic: Boolean\(options\.isStatic\)/);
  assert.doesNotMatch(roomsApi, /authPost|fetchMe|\/auth\/rooms/);
  assert.doesNotMatch(authApi, /createRoom\(/);
});

test('remote microphone playback has subscription and audio-element recovery hooks', () => {
  const livekit = read('src/lib/features/room/client/services/livekit-service.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const syncVoiceSubscriptions = functionBody(livekit, 'syncLiveKitVoiceSubscriptions');
  const subscriptionSync = functionBody(livekit, 'syncLiveKitPublicationSubscription');
  const subscriptionSetter = functionBody(livekit, 'setRemotePublicationSubscribed');
  const recovery = functionBody(livekit, 'ensureRemoteMicrophonePlayback');
  const recoverRoom = functionBody(livekit, 'recoverLiveKitRoom');
  const trackPublishedHandler = livekit.match(/RoomEvent\.TrackPublished[\s\S]*?\n  \}\);/)?.[0] || '';
  const audioRecovery = functionBody(participants, 'ensureRemoteAudioElement');

  assert.match(syncVoiceSubscriptions, /syncLiveKitPublicationSubscription\(peer, publication\)/);
  assert.match(syncVoiceSubscriptions, /ensureRemoteMicrophonePlayback\(peer, publication\)/);
  assert.match(subscriptionSync, /setRemotePublicationSubscribed\(remotePublication, !state\.outputMuted\)/);
  assert.match(subscriptionSetter, /publication\.isDesired === subscribed/);
  assert.match(subscriptionSetter, /publication\.setSubscribed\(subscribed\)/);
  assert.match(recoverRoom, /syncLiveKitVoiceSubscriptions\(\)/);
  assert.doesNotMatch(recoverRoom, /ensureRemoteMicrophonePlaybackForRoom|ensureRemoteMicrophonePlayback\(/);
  assert.match(recovery, /if \(state\.outputMuted\) return/);
  assert.doesNotMatch(recovery, /syncLiveKitPublicationSubscription/);
  assert.match(recovery, /ensureRemoteAudioElement\(peer, mediaTrack, stream, track\.receiver\)/);
  assert.doesNotMatch(trackPublishedHandler, /ensureRemoteMicrophonePlayback/);
  assert.match(audioRecovery, /audioTrack === track && audioTrack\.readyState !== 'ended'/);
  assert.match(audioRecovery, /audio\.isConnected/);
  assert.match(participants, /if \(peer\.micReceiver === receiver\) peer\.micReceiver = null/);
});

test('manual screen receiver demand is ordered, race-safe, and isolated from screen audio', () => {
  const livekitClient = read('src/lib/features/room/client/media/livekit-client.ts');
  const livekit = read('src/lib/features/room/client/services/livekit-service.ts');
  const screenRetry = read('src/lib/features/room/client/media/screen-subscription-retry.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const subscriptionSync = functionBody(livekit, 'syncLiveKitPublicationSubscription');
  const subscriptionSetter = functionBody(livekit, 'setRemotePublicationSubscribed');
  const videoDemand = functionBody(livekit, 'applyRemoteScreenVideoDemand');
  const subscriptionFailure = functionBody(livekit, 'handleLiveKitTrackSubscriptionFailed');
  const subscriptionRetry = functionBody(livekit, 'scheduleScreenSubscriptionRetry');
  const trackUnsubscribed = functionBody(livekit, 'handleLiveKitTrackUnsubscribed');
  const trackUnpublished = functionBody(livekit, 'handleLiveKitTrackUnpublished');
  const attachSubscribedScreen = functionBody(livekit, 'attachSubscribedRemoteScreenTrack');
  const recoverRoom = functionBody(livekit, 'recoverLiveKitRoom');
  const retryDemandedScreens = functionBody(livekit, 'retryDemandedScreenSubscriptions');
  const attachScreen = functionBody(participants, 'attachRemoteScreenStream');
  const detachScreenVideo = functionBody(participants, 'detachRemoteScreenVideoTracks');

  assert.match(livekitClient, /VideoQuality/);
  assert.match(livekit, /function isScreenVideoPublication/);
  assert.match(subscriptionSync, /const subscribed = shouldSubscribeToScreen\(peer\)/);
  assert.match(subscriptionSync, /setRemotePublicationSubscribed\(remotePublication, subscribed\)/);
  assert.match(subscriptionSync, /isScreenVideoPublication\(publication\)/);
  assert.match(subscriptionSync, /void applyRemoteScreenVideoDemand\(peer, remotePublication\)/);
  assert.match(subscriptionSync, /if \(subscribed\) \{[\s\S]*attachSubscribedRemoteScreenTrack\(peer, remotePublication\)/);
  assert.ok(
    subscriptionSync.indexOf('setRemotePublicationSubscribed(remotePublication, subscribed)')
      < subscriptionSync.indexOf('applyRemoteScreenVideoDemand(peer, remotePublication)'),
    'screen video subscribes before requesting a quality layer'
  );
  assert.match(subscriptionSetter, /publication\.isDesired === subscribed/);
  assert.doesNotMatch(subscriptionSetter, /publication\.isSubscribed === subscribed/);
  assert.match(videoDemand, /if \(!isScreenVideoPublication\(publication\)\) return/);
  assert.match(videoDemand, /publication\.isDesired === false/);
  assert.match(videoDemand, /VideoQuality\.HIGH/);
  assert.match(videoDemand, /VideoQuality\.LOW/);
  assert.match(videoDemand, /publication\.setVideoQuality/);
  assert.match(subscriptionFailure, /participant\.trackPublications\.get\(trackSid\)/);
  assert.match(subscriptionFailure, /isScreenPublication\(publication\)/);
  assert.match(subscriptionFailure, /scheduleScreenSubscriptionRetry/);
  assert.match(subscriptionFailure, /if \(!isMicrophonePublication\(publication\)\) return/);
  assert.match(screenRetry, /SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS = \[150, 600, 1500\]/);
  assert.match(subscriptionRetry, /SubscriptionError\.SE_CODEC_UNSUPPORTED/);
  assert.match(subscriptionRetry, /screenSubscriptionRetryController\.schedule/);
  assert.match(subscriptionRetry, /publication\.setSubscribed\(false\)/);
  assert.match(subscriptionRetry, /publication\.setSubscribed\(true\)/);
  assert.match(recoverRoom, /clearAllScreenSubscriptionRetries\(\)/);
  assert.match(recoverRoom, /retryDemandedScreenSubscriptions\(room\)/);
  assert.ok(
    recoverRoom.indexOf('clearAllScreenSubscriptionRetries()')
      < recoverRoom.indexOf('syncLiveKitParticipants(room)'),
    'reconnect starts a fresh retry epoch before publication reconciliation'
  );
  assert.match(retryDemandedScreens, /shouldSubscribeToScreen\(peer\)/);
  assert.match(retryDemandedScreens, /attachSubscribedRemoteScreenTrack\(peer, remotePublication\)/);
  assert.match(retryDemandedScreens, /scheduleScreenSubscriptionRetry\(peer, remotePublication\)/);
  assert.match(trackUnsubscribed, /isScreenVideoPublication\(publication\)/);
  assert.match(trackUnsubscribed, /isScreenAudioPublication\(publication\)/);
  assert.match(trackUnsubscribed, /detachRemoteScreenVideoTrack\(peer, track\.mediaStreamTrack\.id\)/);
  assert.match(trackUnsubscribed, /detachRemoteScreenAudioTrack\(peer, track\.mediaStreamTrack\.id\)/);
  assert.match(trackUnsubscribed, /shouldSubscribeToScreen\(peer\)/);
  assert.match(trackUnsubscribed, /scheduleScreenSubscriptionRetry\(peer, publication\)/);
  assert.match(trackUnpublished, /detachRemoteScreenVideoTracks\(peer\)/);
  assert.match(trackUnpublished, /peer\.screen = peer\.screenAuthoritative === false \? false : screenPresence\.active/);
  assert.match(trackUnpublished, /if \(!screenPresence\.hasVideo\) detachRemoteScreenVideoTracks\(peer\)/);
  assert.match(attachSubscribedScreen, /publication\.isSubscribed === false/);
  assert.match(attachSubscribedScreen, /publication\.track as RemoteTrack/);
  assert.match(attachSubscribedScreen, /mediaTrack\.readyState === 'ended'\) return false/);
  assert.match(attachSubscribedScreen, /attachRemoteScreenStream/);
  assert.match(attachSubscribedScreen, /return Boolean/);
  assert.match(attachScreen, /const hasVideo = screenStream\.getVideoTracks\(\)/);
  assert.match(attachScreen, /if \(hasVideo\) state\.screenRequesting = false/);
  assert.match(attachScreen, /detachRemoteScreenVideoTrack\(peer, track\.id\)/);
  assert.match(detachScreenVideo, /stream\.getVideoTracks\(\)/);
  assert.match(detachScreenVideo, /if \(!removed\) return/);
  assert.match(detachScreenVideo, /if \(!hasRemoteScreenVideo\(peer\)\)/);
  assert.doesNotMatch(detachScreenVideo, /stream\.getAudioTracks\(\)/);
});

test('lobby v2 keeps dock in main area, switchable preview panels, and people add-friend flow', () => {
  const controls = read('src/lib/features/room/styles/controls.css');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  assert.match(sidebar, /import \{[^}]*\bAvatar\b[^}]*\bBadge\b[^}]*\bPopover\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.doesNotMatch(sidebar, /ContextMenu|FriendMenuContent/);
  assert.match(sidebar, /onOpenPeople/);
  assert.doesNotMatch(sidebar, /lastMessagePreview/);
  assert.doesNotMatch(sidebar, /entry\.lastMessage\.body/);
  const previewView = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const browseView = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');
  const peopleView = read('src/lib/features/home/components/lobby/PeopleView.svelte');
  const friendsCss = read('src/lib/features/home/styles/friends.css');

  assert.match(controls, /body\[data-lobby-embedded="true"\] \.room-dock/);
  assert.match(controls, /left: var\(--lobby-sidebar-width, 312px\)/);
  const roomLayoutCss = read('src/lib/features/room/styles/layout.css');
  assert.match(roomLayoutCss, /body\[data-lobby-embedded="true"\] \.app-shell\.room-embedded-shell/);
  assert.match(roomLayoutCss, /body\[data-lobby-embedded="true"\] \.room-embedded-shell \.topbar/);
  assert.match(sidebar, /import SidebarDownload from '\.\.\/SidebarDownload\.svelte'/);
  assert.match(sidebar, /<SidebarDownload \/>/);
  for (const view of [previewView, browseView]) {
    assert.match(view, /RoomPreviewChat/);
    assert.match(view, /let activePanel = \$state<'chat' \| 'participants' \| null>\(null\)/);
    assert.match(view, /aria-label="Чат"/);
    assert.match(view, /aria-label="Участники"/);
    assert.match(view, /<MessageSquare/);
    assert.match(view, /<Users/);
    assert.match(view, /aria-label="Свернуть панель"/);
    assert.match(view, /onClose=\{\(\) => \(activePanel = null\)\}/);
    assert.match(view, /onSelectParticipants=\{\(\) => selectPanel\('participants'\)\}/);
  }
  assert.match(previewView, /getCapabilityFeature\('membership'\)/);
  assert.match(browseView, /getCapabilityFeature\('membership'\)/);
  assert.match(previewView, /<RoomMemberList roomId=\{previewRoomId\} \/>/);
  assert.match(browseView, /<RoomMemberList roomId=\{previewRoomId\} \/>/);
  assert.match(previewView, /data-members-open=\{activePanel === 'participants'\}/);
  assert.match(browseView, /data-members-open=\{activePanel === 'participants'\}/);
  assert.match(previewView, /data-preview-chat-open=\{activePanel === 'chat'\}/);
  assert.match(browseView, /data-preview-chat-open=\{activePanel === 'chat'\}/);
  assert.match(previewView, /'\$lib\/features\/room\/styles\/room\.css'/);
  assert.match(browseView, /'\$lib\/features\/room\/styles\/room\.css'/);
  assert.match(previewView, /class="stage lobby-preview-stage"/);
  assert.match(browseView, /class="stage lobby-preview-stage"/);
  assert.match(previewView, /class="participant lobby-preview-participant"/);
  assert.match(browseView, /class="participant lobby-preview-participant"/);
  assert.doesNotMatch(previewView, /lobby-stage-tile|lobby-stage-avatar|lobby-stage-grid/);
  assert.doesNotMatch(browseView, /lobby-stage-tile|lobby-stage-avatar|lobby-stage-grid/);
  assert.doesNotMatch(friendsCss, /lobby-stage-tile|lobby-stage-avatar|lobby-stage-grid/);
  assert.doesNotMatch(previewView, /тихо сейчас/);
  assert.doesNotMatch(browseView, /тихо сейчас/);
  assert.match(previewView, /const previewRoomId = \$derived\(room\.roomId\)/);
  assert.match(browseView, /const previewRoomId = \$derived\(room\.roomId\)/);
  assert.match(previewView, /\$effect\(\(\) => \{\s*const roomId = previewRoomId;[\s\S]*subscribeRoomPreview\(roomId, handlePreviewEvent\)/);
  assert.match(browseView, /\$effect\(\(\) => \{\s*const roomId = previewRoomId;[\s\S]*subscribeRoomPreview\(roomId, handlePreviewEvent\)/);
  assert.match(peopleView, /copyText\(user\.login\)/);
  assert.doesNotMatch(peopleView, /searchUsers/);
  assert.doesNotMatch(peopleView, /oninput=\{onInput\}/);
  assert.match(peopleView, /@\{user\.login\}/);
  assert.match(friendsCss, /\.lobby-room-members/);
  assert.match(friendsCss, /data-members-open/);
  const roomStage = read('src/lib/features/room/components/RoomStage.svelte');
  const roomPage = read('src/lib/features/room/RoomPage.svelte');
  const roomChat = readRoomChat();
  const memberList = read('src/lib/features/home/components/lobby/RoomMemberList.svelte');
  const membershipState = read('src/lib/features/home/model/room-membership.svelte.ts');
  assert.match(roomPage, /<RoomStage \/>/);
  assert.doesNotMatch(roomStage, /RoomMemberList|room-members-rail|data-members-open/);
  assert.match(roomChat, /<RoomMemberList \{roomId\} \/>/);
  assert.match(roomChat, /roomUi\.activePanel === 'participants'/);
  assert.match(memberList, /В сети — \{onlineMembers\.length\}/);
  assert.match(memberList, /Не в сети — \{offlineMembers\.length\}/);
  assert.doesNotMatch(memberList, /searchable|room-member-list__search|Найти участника/);
  assert.doesNotMatch(memberList, /Создатель|<h2[^>]*>Участники<\/h2>/);
  assert.match(memberList, /roomMembershipState\.byRoomId\[roomId\] \?\? null/);
  assert.match(memberList, /const currentRoomId = roomId;/);
  assert.match(memberList, /untrack\(\(\) => \{\s*getRoomMembership\(currentRoomId\);\s*void loadRoomMembership\(currentRoomId\);\s*\}\);/);
  assert.doesNotMatch(memberList, /\$derived\(getRoomMembership\(roomId\)\)/);
  assert.doesNotMatch(memberList, /В голосовом канале|Остальные/);
  assert.doesNotMatch(membershipState, /left\.inVoice !== right\.inVoice|left\.role !== right\.role|localeCompare/);
  assert.match(friendsCss, /\.lobby-dm-head[\s\S]*border: 0/);
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  assert.match(dmView, /bind:this=\{inputEl\}/);
  assert.match(dmView, /inputEl\?\.focus\(\)/);
  // 2.4.0 DM multiline + links
  assert.match(dmView, /ChatText/);
  assert.match(dmView, /lobby-dm-textarea/);
  assert.match(dmView, /onKeydown|onkeydown=\{onKeydown\}/);
  assert.match(lobby, /import '\$lib\/features\/room\/styles\/chat-rail\.css'/);
});

test('chat composers and add-friend control preserve compact keyboard-first behavior', () => {
  const people = read('src/lib/features/home/components/lobby/PeopleView.svelte');
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const lobbyV2 = read('src/lib/features/home/styles/lobby-v2.css');
  const friends = read('src/lib/features/home/styles/friends.css');
  const roomChat = readRoomChat();
  const previewChat = readPreviewChat();
  const roomChatCss = read('src/lib/features/room/styles/chat-rail.css');
  const dmSubmit = functionBody(dm, 'submit');
  const roomSubmit = functionBody(roomChat, 'sendMessage');
  const previewSubmit = functionBody(previewChat, 'sendMessage');

  assert.match(people, /На главную/);
  assert.doesNotMatch(dm, /На главную|ChevronLeft/);
  assert.match(lobbyV2, /\.lr-add-field\s*\{[^}]*height:\s*var\(--interactive-lg, 52px\)/);
  assert.match(lobbyV2, /\.lr-add-field input\s*\{[^}]*height:\s*100%[^}]*padding:\s*0/);

  for (const composer of [dm, roomChat, previewChat]) {
    assert.match(composer, /rows="1"/);
    assert.match(composer, /\.isComposing\) return/);
    assert.match(composer, /\.key === 'Enter' && !\w+\.shiftKey/);
  }
  assert.match(friends, /\.lobby-dm-textarea\s*\{[^}]*height:\s*48px[^}]*max-height:\s*140px/);
  assert.match(friends, /\.lobby-dm-input\s*\{[^}]*padding:\s*13px 16px/);
  assert.match(roomChatCss, /\.chat-rail-textarea\s*\{[^}]*height:\s*42px[^}]*max-height:\s*140px/);
  assert.match(roomChatCss, /\.chat-rail-input\s*\{[^}]*padding:\s*10px 14px/);

  assert.ok(dmSubmit.indexOf('await sendMessage(text)') < dmSubmit.indexOf("draft = ''"));
  assert.ok(dmSubmit.indexOf("draft = ''") < dmSubmit.indexOf("inputEl.style.height = ''"));
  assert.doesNotMatch(dmSubmit.slice(dmSubmit.indexOf('catch'), dmSubmit.indexOf('finally')), /draft\s*=/);
  assert.ok(roomSubmit.indexOf('await postRoomChat') < roomSubmit.indexOf("draft = ''"));
  assert.ok(roomSubmit.indexOf("draft = ''") < roomSubmit.indexOf("composeEl.style.height = ''"));
  assert.doesNotMatch(roomSubmit.slice(roomSubmit.indexOf('catch'), roomSubmit.indexOf('finally')), /draft\s*=/);
  assert.ok(previewSubmit.indexOf('await postRoomChat') < previewSubmit.indexOf("draft = ''"));
  assert.ok(previewSubmit.indexOf("draft = ''") < previewSubmit.indexOf("composeEl.style.height = ''"));
  assert.doesNotMatch(previewSubmit.slice(previewSubmit.indexOf('catch'), previewSubmit.indexOf('finally')), /draft\s*=/);

  for (const [body, element] of [
    [dmSubmit, 'inputEl'],
    [roomSubmit, 'composeEl'],
    [previewSubmit, 'composeEl']
  ]) {
    assert.match(body, /if \(!sent\) return;\s*await tick\(\)/);
    assert.ok(body.indexOf('sending = false') < body.indexOf('await tick()'));
    assert.ok(body.indexOf(`${element}.style.height = ''`) < body.indexOf(`${element}?.focus()`));
  }

  assert.doesNotMatch(`${roomChat}\n${previewChat}`, /\bSend\b|chat-rail-send/);
  assert.doesNotMatch(roomChatCss, /\.chat-rail-send/);
});

test('user and room avatars expose accessible edit overlays and conditional delete controls', () => {
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const settingsCss = read('src/lib/features/home/styles/settings.css');
  const roomSettings = read('src/lib/features/room/components/RoomSettingsDialog.svelte');
  const lobbyRoomSettings = read('src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte');

  assert.match(settings, /<button[\s\S]*?class="settings-avatar-edit"[\s\S]*?aria-label=\{user\?\.avatarUrl \? 'Изменить аватар' : 'Загрузить аватар'\}[\s\S]*?<Pencil/);
  assert.match(settings, /\{#if avatarPreviewUrl \|\| \(user\?\.avatarUrl && !removeAvatarPending\)\}[\s\S]*?<button[\s\S]*?class="settings-avatar-remove"[\s\S]*?aria-label="Удалить аватар"[\s\S]*?<X/);
  assert.match(settingsCss, /\.settings-avatar-edit:not\(:disabled\):focus-visible \.settings-avatar-overlay\s*\{[^}]*opacity:\s*1/);
  assert.match(settingsCss, /\.settings-avatar-edit:focus-visible\s*\{[^}]*outline:/);
  assert.match(settingsCss, /\.settings-avatar-remove:focus-visible\s*\{[^}]*outline:/);

  assert.match(roomSettings, /<button[\s\S]*?class="room-avatar-edit"[\s\S]*?aria-label=\{roomClientState\.roomAvatarUrl \? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'\}[\s\S]*?<Pencil/);
  assert.match(roomSettings, /\{#if avatarPreviewUrl \|\| \(roomClientState\.roomAvatarUrl && !removeAvatarPending\)\}[\s\S]*?<button[\s\S]*?class="room-avatar-remove"[\s\S]*?aria-label="Удалить аватар комнаты"[\s\S]*?<X/);
  assert.match(roomSettings, /\.room-avatar-edit:not\(:disabled\):focus-visible \.room-avatar-overlay\s*\{[^}]*opacity:\s*1/);
  assert.match(roomSettings, /\.room-avatar-edit:focus-visible\s*\{[^}]*outline:/);
  assert.match(roomSettings, /\.room-avatar-remove:focus-visible\s*\{[^}]*outline:/);

  for (const source of [settings, settingsCss]) {
    assert.doesNotMatch(source, /settings-avatar-(?:actions|upload|delete)/);
  }
  assert.doesNotMatch(settings, /\b(?:ImagePlus|Trash2)\b/);
  assert.doesNotMatch(roomSettings, /room-avatar-(?:row|actions|upload|delete)/);
  assert.doesNotMatch(roomSettings, /\b(?:ImagePlus|Trash2)\b/);

  assert.match(lobbyRoomSettings, /uploadRoomAvatar/);
  assert.match(lobbyRoomSettings, /deleteRoomAvatar/);
  assert.match(lobbyRoomSettings, /<button[\s\S]*?class="room-avatar-edit"[\s\S]*?aria-label=\{room\.avatarUrl \? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'\}[\s\S]*?<Pencil/);
  assert.match(lobbyRoomSettings, /\{#if avatarPreviewUrl \|\| \(room\.avatarUrl && !removeAvatarPending\)\}[\s\S]*?<button[\s\S]*?class="room-avatar-remove"[\s\S]*?aria-label="Удалить аватар комнаты"[\s\S]*?<X/);
  assert.match(lobbyRoomSettings, /<AvatarCropDialog[\s\S]*?shape="squircle"[\s\S]*?kind="room"/);
  assert.match(lobbyRoomSettings, /\.dialog-danger-trigger\s*\{[^}]*border:\s*1px solid rgba\(239, 68, 68, 0\.4\)[^}]*color:\s*#f87171/);
  assert.match(lobbyRoomSettings, /\.dialog-danger-confirm\s*\{[^}]*background:\s*var\(--coral\)[^}]*color:\s*#fff/);
});

test('frontend visual catalog keeps only user avatar color contracts', () => {
  const shared = require('@voice-room/shared/validation');
  const tokens = read('src/lib/visual/tokens.ts');

  for (const key of shared.AVATAR_COLOR_KEYS) {
    assert.ok(tokens.includes(`${key}: { key: '${key}'`));
  }
  assert.doesNotMatch(tokens, /ROOM_PRESETS|ROOM_COLOR_TOKENS|ROOM_ICON_EMOJIS/);
});

test('shared typography uses CSP-safe local UI, display, and mono font roles', () => {
  const typography = read('src/lib/shared/styles/typography.css');
  const appCss = read('src/lib/shared/styles/app.css');
  const topbar = read('src/lib/shared/components/topbar.css');
  const auth = read('src/lib/features/auth/styles/auth.css');
  const home = read('src/lib/features/home/styles/home.css');
  const lobby = read('src/lib/features/home/styles/lobby.css');
  const lobbyV2 = read('src/lib/features/home/styles/lobby-v2.css');
  const voiceHome = read('src/lib/features/home/components/lobby/VoiceHome.svelte');
  const friends = read('src/lib/features/home/styles/friends.css');
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  const chatCss = read('src/lib/features/room/styles/chat-rail.css');
  const settings = read('src/lib/features/home/styles/settings.css');
  const roomLayout = read('src/lib/features/room/styles/layout.css');
  const stageLayout = read('src/lib/features/room/styles/stage-layout.css');
  const roomControls = read('src/lib/features/room/styles/controls.css');
  const roomParticipants = read('src/lib/features/room/styles/participants.css');
  const roomMenuContent = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');
  const provenance = read('static/fonts/README.md');
  const appSourceFiles = readTreeFiles('src/lib', (path) => /\.(css|svelte)$/.test(path));
  const appSources = appSourceFiles.map(({ source }) => source).join('\n');

  for (const file of [
    'comfortaa-cyrillic-ext.woff2',
    'comfortaa-cyrillic.woff2',
    'comfortaa-latin-ext.woff2',
    'comfortaa-latin.woff2',
    'nunito-cyrillic-ext.woff2',
    'nunito-cyrillic.woff2',
    'nunito-latin-ext.woff2',
    'nunito-latin.woff2',
    'jetbrainsmono-cyrillic.woff2',
    'jetbrainsmono-latin-ext.woff2',
    'jetbrainsmono-latin.woff2'
  ]) {
    assert.ok(existsSync(resolve(root, 'static/fonts', file)), `${file} is bundled`);
    assert.match(typography, new RegExp(`url\\('/fonts/${file}'\\) format\\('woff2'\\)`));
    assert.match(provenance, new RegExp(`[a-f0-9]{64}  ${file}`));
  }

  assert.doesNotMatch(typography, /https?:\/\//);
  assert.doesNotMatch(typography, /fonts\.googleapis|fonts\.gstatic|Archivo/);
  assert.match(typography, /font-family: 'Nunito'/);
  assert.match(typography, /font-family: 'Comfortaa'/);
  assert.match(typography, /font-family: 'JetBrains Mono'/);
  assert.match(typography, /--font-ui: 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif;/);
  assert.match(typography, /--font-display: 'Comfortaa', 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif;/);
  assert.match(typography, /--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', monospace;/);
  assert.match(typography, /--font-sans: var\(--font-ui\);/);
  assert.match(typography, /--font-serif: var\(--font-display\);/);
  assert.match(typography, /U\+0301, U\+0400-045F/);
  assert.match(typography, /U\+0000-00FF/);
  assert.match(appCss, /font-family: var\(--font-ui\);/);
  assert.match(provenance, /SIL Open Font License 1\.1/);

  assert.doesNotMatch(appSources, /fonts\.googleapis|fonts\.gstatic|Archivo|Aptos|"Arial Narrow"/);
  assert.doesNotMatch(appSources, /font-family:\s*var\(--font-sans(?:[,)]|;)/);
  assert.doesNotMatch(appSources, /font-family:\s*var\(--font-serif(?:[,)]|;)/);
  assert.doesNotMatch(`${voiceHome}\n${lobbyV2}`, /min-width:\s*min-content/);
  const lrTitleRule = lobbyV2.match(/\.lr-title\s*\{(?<body>[^}]*)\}/);
  assert.ok(lrTitleRule, '.lr-title rule is present');
  assert.doesNotMatch(lrTitleRule.groups.body, /(?:^|[;\s])(?:min-width|width|max-width)\s*:/);
  assertSupportedFontWeights(appSourceFiles, typography);

  assertRuleFont(topbar, '.brand', '--font-display');
  assertRuleFont(typography, '.hero-title', '--font-display');
  assertRuleFont(home, '.landing-title', '--font-display');
  assertRuleFont(stageLayout, 'h1', '--font-display');
  assertRuleFont(roomLayout, '.not-found-title', '--font-display');

  assertRuleFont(auth, '.auth-title', '--font-ui');
  assertRuleFont(auth, '.auth-label', '--font-ui');
  assertRuleFont(lobbyV2, '.lv', '--font-ui');
  assertRuleFont(lobbyV2, '.lv-sec-head', '--font-ui');
  assertRuleFont(lobby, '.lobby-section-title', '--font-ui');
  assertRuleFont(friends, '.lobby-roomview-name', '--font-ui');
  assertRuleFont(settings, '.settings-field-label', '--font-ui');
  assertRuleFont(settings, '.settings-sound-value', '--font-ui');
  assertRuleFont(roomLayout, '.room-heading-title', '--font-ui');
  assertRuleFont(roomControls, '.room-chat-unread', '--font-ui');

  assertRuleFont(lobby, '.lobby-search-input', '--font-mono');
  assertRuleFont(lobby, '.room-card-code', '--font-mono');
  assertRuleFont(friends, '.lobby-profile-handle', '--font-mono');
  assert.match(dmView, /class="chat-msg-time"/);
  assertRuleFont(chatCss, '.chat-msg-time', '--font-mono');
  assert.match(roomMenuContent, /\.room-menu-code\) \{[\s\S]*font-family: var\(--font-mono\)/);
});

test('remote participant audio preferences persist volume and local mute separately', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const settings = read('src/lib/features/room/client/core/settings.ts');
  const playback = read('src/lib/features/room/client/services/media-playback-service.ts');
  const audioBus = read('src/lib/features/room/client/services/audio-bus.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');

  assert.match(config, /PARTICIPANT_AUDIO_PREFERENCES_STORAGE_KEY = 'voice-room:participant-audio-preferences'/);
  assert.match(config, /DEFAULT_PARTICIPANT_VOLUME = 1/);
  assert.match(config, /MAX_PARTICIPANT_VOLUME = 2/);

  assert.match(settings, /interface ParticipantAudioPreference[\s\S]*muted: boolean;[\s\S]*volume: number;/);
  assert.match(settings, /getParticipantAudioPreferenceKey\(accountUserId: string, peerId: string\)/);
  assert.match(functionBody(settings, 'getParticipantAudioPreferenceKey'), /return `account:\$\{accountKey\}`/);
  assert.match(functionBody(settings, 'getParticipantAudioPreferenceKey'), /return `peer:\$\{String\(peerId \|\| ''\)\.trim\(\)\}`/);
  assert.match(settings, /export function getParticipantAudioPreference\(key: string\): ParticipantAudioPreference \{[\s\S]*DEFAULT_PARTICIPANT_AUDIO_PREFERENCE\.muted[\s\S]*DEFAULT_PARTICIPANT_AUDIO_PREFERENCE\.volume[\s\S]*\n\}/);
  assert.match(functionBody(settings, 'storeParticipantAudioPreference'), /muted: Object\.hasOwn\(patch, 'muted'\)/);
  assert.match(functionBody(settings, 'storeParticipantAudioPreference'), /volume: Object\.hasOwn\(patch, 'volume'\)/);
  assert.match(functionBody(settings, 'clampParticipantVolume'), /Math\.min\(MAX_PARTICIPANT_VOLUME, Math\.max\(0, volume\)\)/);

  assert.match(playback, /export function applyRemoteParticipantAudioPreferences\(peer: Participant\)/);
  assert.match(functionBody(playback, 'applyRemoteParticipantAudioPreferences'), /getParticipantAudioPreferenceKey\(peer\.accountUserId, peer\.id\)/);
  assert.match(functionBody(playback, 'applyRemoteParticipantAudioPreferences'), /isAppPlaybackMuted\(\) \|\| preference\.muted \|\| preference\.volume <= 0/);
  assert.match(functionBody(playback, 'applyRemoteParticipantAudioPreferences'), /routeMediaStreamElement\(audio, 'voice', \{ muted, volume: preference\.volume \}\)/);
  const outputSyncBody = functionBody(playback, 'syncAudioOutputDevices');
  assert.match(outputSyncBody, /syncAudioBusOutput\(\)/);
  assert.match(playback, /export function releaseRemoteAudioElement\(mediaElement: HTMLMediaElement\)/);
  assert.match(functionBody(playback, 'releaseRemoteAudioElement'), /releaseMediaStreamElement\(mediaElement\)/);

  assert.match(audioBus, /voice\.connect\(master\)/);
  assert.match(audioBus, /media\.connect\(master\)/);
  assert.match(audioBus, /sfx\.connect\(master\)/);
  assert.match(audioBus, /master\.connect\(limiter\)/);
  assert.match(audioBus, /createDynamicsCompressor\(\)/);
  assert.match(audioBus, /createMediaStreamSource\(stream\)/);
  assert.match(audioBus, /Math\.min\(2, Math\.max\(0, options\.volume\)\)/);
  assert.match(audioBus, /createMediaStreamDestination\(\)/);
  assert.match(audioBus, /sinkElement!\.setSinkId\(sinkId\)/);
  assert.doesNotMatch(playback, /createMediaElementSource|rebuildActiveVoiceAudioElementsForOutputSwitch|applyVoiceMediaElementVolume/);

  assert.match(participants, /applyRemoteParticipantAudioPreferences\(peer\)/);
  assert.match(participants, /const hadAccountUserId = participant\.accountUserId/);
  assert.match(participants, /participant\.accountUserId !== hadAccountUserId[\s\S]*applyRemoteParticipantAudioPreferences\(participant\)/);
  assert.match(participants, /releaseRemoteAudioElement\(audio\)/);
  assert.match(participants, /audio\.srcObject = new MediaStream\(\[track\]\)/);
});

test('remote participant tiles do not show transient voice-connecting placeholder', () => {
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const livekit = read('src/lib/features/room/client/services/livekit-service.ts');
  const tile = read('src/lib/features/room/components/ParticipantTile.svelte');

  assert.match(tile, /participant\.statusLabel/);
  assert.doesNotMatch(`${participants}
${livekit}`, /подключает голос/);
  assert.match(participants, /statusLabel: ''/);
  assert.match(participants, /export function detachLiveKitParticipant\(peer: Participant, voiceIssue = ''\)/);
  assert.match(livekit, /peer\.voiceIssue = 'голос не подключен'/);
  assert.match(livekit, /detachLiveKitParticipant\(peer, 'голос переподключается'\)/);
});

test('stream viewer presence follows attendance instead of spotlight layout', async () => {
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const presence = read('src/lib/features/room/client/room/presence.ts');
  const room = read('src/lib/features/room/client/room/room.ts');
  const screenView = read('src/lib/features/room/client/ui/screen-view.ts');
  const dock = read('src/lib/features/room/components/RoomDock.svelte');
  const attendance = await importTypeScript('src/lib/features/room/client/model/screen-attendance.ts');

  const self = { viewedScreenPeerId: '' };
  assert.equal(attendance.setScreenAttendance(self, 'screen-a'), true);
  assert.equal(self.viewedScreenPeerId, 'screen-a');
  assert.equal(attendance.setScreenAttendance(self, 'screen-a'), false);
  assert.equal(attendance.setScreenAttendance(self, 'screen-b'), true);
  assert.equal(attendance.clearScreenAttendance(self, 'screen-a'), false);
  assert.equal(attendance.clearScreenAttendance(self, 'screen-b'), true);
  assert.equal(self.viewedScreenPeerId, '');

  assert.doesNotMatch(participants, /экран в эфире|показывает экран/);
  assert.match(presence, /viewedScreenPeerId: state\.self\?\.viewedScreenPeerId \|\| ''/);
  assert.match(participants, /if \(state\.localScreenStream && state\.peerId\) ownerIds\.add\(state\.peerId\)/);
  assert.match(participants, /const attendedPeerId = state\.self\?\.viewedScreenPeerId \|\| ''/);
  assert.doesNotMatch(participants, /const ownerIds = new Set\(state\.screenSubscribedPeerIds\)/);
  assert.match(screenView, /if \(!peer\.isLocal\) setScreenAttendance\(state\.self, peerId\)/);
  assert.match(screenView, /if \(keepPreview\)[\s\S]*screenSubscribedPeerIds\.add\(peerId\)[\s\S]*else \{[\s\S]*clearScreenAttendance\(state\.self, peerId\)/);
  assert.match(screenView, /const attendanceCleared = clearScreenAttendance\(state\.self, peerId\)[\s\S]*if \(attendanceCleared\) postState\(\)/);
  assert.match(screenView, /handleScreenStageClick[\s\S]*leaveScreenView\(\{ keepPreview: true \}\)/);
  assert.match(dock, /aria-label="Выйти со стрима"[\s\S]*leaveScreenView\(\{ keepPreview: false \}\)/);
  assert.match(participants, /state\.self\?\.viewedScreenPeerId === participant\.id[\s\S]*disconnectScreenSoon\(participant\.id\)/);
  assert.match(participants, /state\.self\?\.viewedScreenPeerId === peerId[\s\S]*disconnectScreenSoon\(peerId\)/);
  assert.match(room, /viewedScreenPeerId: state\.self\?\.viewedScreenPeerId \?\? localPeer\.viewedScreenPeerId/);
});

test('participant context menu is remote-only and exposes relationship-aware local audio controls', () => {
  const menu = read('src/lib/features/room/components/ParticipantContextMenu.svelte');
  const contextUi = read('src/lib/features/room/participant-context-ui.svelte.ts');
  const tile = read('src/lib/features/room/components/ParticipantTile.svelte');
  const main = read('src/lib/features/room/client/main.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const room = read('src/lib/features/room/client/room/room.ts');
  const css = read('src/lib/features/room/styles/participants.css');

  assert.doesNotMatch(main, /bindParticipantContextMenu/);
  assert.match(tile, /oncontextmenu=\{handleContextMenu\}/);
  assert.match(tile, /onkeydown=\{handleKeydown\}/);
  assert.match(tile, /event\.preventDefault\(\)/);
  assert.match(tile, /event\.key === 'ContextMenu'/);
  assert.match(tile, /event\.key === 'F10' && event\.shiftKey/);
  assert.match(tile, /tabindex="0"/);
  assert.match(tile, /aria-haspopup=\{participant\.isLocal \? undefined : 'dialog'\}/);
  assert.match(tile, /openParticipantContextMenu\(participant\.id/);

  assert.match(menu, /const canUseSocialActions = \$derived/);
  assert.match(menu, /getFriendRelationship\(peer\.accountUserId\)/);
  assert.match(menu, /label="Написать"/);
  assert.match(menu, /label="Принять заявку"/);
  assert.match(menu, /label="Заявка отправлена"/);
  assert.match(menu, /Добавить в друзья/);
  assert.match(menu, /Гость: доступны только локальные настройки звука/);

  assert.match(menu, /min=\{0\}/);
  assert.match(menu, /max=\{200\}/);
  assert.match(menu, /const safePercent = Math\.min\(200, Math\.max\(0, Number\.isFinite\(percent\) \? percent : 100\)\)/);
  assert.match(menu, /storeParticipantAudioPreference\(preferenceKey, \{ volume: safePercent \/ 100 \}\)/);
  assert.match(menu, /muted: !getParticipantAudioPreference\(preferenceKey\)\.muted/);
  assert.match(menu, /applyRemoteParticipantAudioPreferences\(peer\)/);

  assert.match(menu, /<ContextMenu/);
  const contextMenuPrimitive = read('src/lib/shared/ui/ContextMenu/ContextMenu.svelte');
  assert.match(contextMenuPrimitive, /window\.addEventListener\('keydown', handleKeydown/);
  assert.match(contextMenuPrimitive, /window\.addEventListener\('pointerdown', handlePointerDown, \{ capture: true \}\)/);
  assert.match(contextMenuPrimitive, /onfocusout=\{handleFocusOut\}/);
  assert.match(contextUi, /restoreFocusPeerId/);
  assert.match(contextUi, /focusTarget\?\.isConnected/);
  assert.match(contextMenuPrimitive, /\[contenteditable="true"\]/);
  assert.match(contextMenuPrimitive, /role === 'dialog' \|\| ownsNavigation/);
  assert.match(menu, /role="dialog"/);
  assert.match(participants, /closeParticipantContextMenu\(peerId\)/);
  assert.match(room, /closeParticipantContextMenu\(\)/);
  assert.match(menu, /const peerId = peer\.id/);
  assert.match(menu, /const accountUserId = peer\?\.accountUserId/);
  assert.match(menu, /closeParticipantContextMenu\(peer\.id, false\)/);
  assert.match(menu, /addFriendByUserId\(accountUserId\)/);
  assert.match(menu, /acceptRequestByUserId\(accountUserId\)/);
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  assert.match(functionBody(friends, 'initLobby'), /connectRealtime\(handleRealtimeEvent\)/);
  assert.match(functionBody(friends, 'initLobby'), /Promise\.all\(\[refreshFriends\(\), refreshRequests\(\)\]\)/);
  assert.match(functionBody(friends, 'refreshFriends'), /friendOnlineFromPresence\(friend\.user\.id, friend\.online\)/);
  assert.match(functionBody(friends, 'handleRealtimeEvent'), /setOnlineSnapshot\(event\.payload\.onlineFriendIds(?: \?\? \[\])?\)/);
  assert.match(
    functionBody(friends, 'friendOnlineFromPresence'),
    /presenceReady && presenceKnownFriendIds\.has\(userId\)/
  );
  const refreshFriendsBody = functionBody(friends, 'refreshFriends');
  assert.match(refreshFriendsBody, /presenceKnownFriendIds\.add\(friend\.user\.id\)/);
  assert.match(refreshFriendsBody, /if \(friend\.online\) onlineFriendIds\.add\(friend\.user\.id\)/);
  assert.match(functionBody(friends, 'handleRealtimeEvent'), /setFriendOnline\(event\.payload\.userId, event\.payload\.online\)/);
  const realtime = read('src/lib/api/realtime.ts');
  assert.match(realtime, /new WebSocket\(wsUrl\(\)\)/);
  assert.match(realtime, /\/api\/ws/);
  assert.match(realtime, /friend\.presence/);
  assert.match(functionBody(friends, 'getFriendRelationship'), /requests\.incoming\.some/);
  assert.match(functionBody(friends, 'getFriendRelationship'), /requests\.outgoing\.some/);
  assert.match(menu, /setMode\('friends'\)/);
  assert.match(menu, /await openDm\(accountUserId\)/);
  assert.match(menu, /function errorToastMessage\(error: unknown, fallback: string\): string/);
  // Failures funnel through one helper; each action supplies its own fallback.
  assert.match(menu, /showToast\(errorToastMessage\(error, fallback\), \{ variant: 'error' \}\)/);
  assert.match(menu, /'Не удалось отправить заявку в друзья'/);
  assert.match(menu, /'Не удалось принять заявку в друзья'/);
  assert.match(menu, /'Не удалось открыть личные сообщения'/);

  // The menu chrome comes from the shared primitives; only the volume block is
  // still local to this component.
  assert.match(menu, /class="participant-menu"/);
  assert.match(menu, /\.participant-menu-volume/);
  assert.match(menu, /<Slider[\s\S]*bind:value=\{volumePercent\}/);
});

test('notification cue volume respects stored multiplier', () => {
  const cues = read('src/lib/features/room/client/media/cues.ts');
  const settings = read('src/lib/features/room/client/core/settings.ts');
  const audioBus = read('src/lib/features/room/client/services/audio-bus.ts');

  assert.match(settings, /getNotificationVolumeMultiplier/);
  assert.match(audioBus, /graph\.sfx\.gain\.value = getNotificationVolumeMultiplier\(\)/);
  assert.match(cues, /getAudioBusInput\('sfx'\)/);
  assert.doesNotMatch(cues, /gain\.connect\(context\.destination\)/);
});

test('sound cue layer covers direct messages and friend request events', () => {
  const cues = read('src/lib/features/room/client/media/cues.ts');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const roomChat = readRoomChat();
  const previewChat = readPreviewChat();
  const settingsModal = read('src/lib/features/home/components/SettingsModal.svelte');

  assert.match(cues, /playDirectMessageCue/);
  assert.match(cues, /playRoomChatMessageCue/);
  assert.match(cues, /playFriendRequestCue/);
  assert.match(cues, /playFriendAcceptedCue/);
  assert.match(cues, /playCueSequence/);
  assert.match(friends, /case 'friend\.request'[\s\S]*playFriendRequestCue\(\)/);
  assert.match(friends, /case 'friend\.accepted'[\s\S]*playFriendAcceptedCue\(\)/);
  assert.match(friends, /case 'dm\.message'[\s\S]*playDirectMessageCue\(\)/);
  assert.match(roomChat, /event\.type !== 'room\.chat\.message'[\s\S]*message\.peerId !== peerId[\s\S]*playRoomChatMessageCue\(\)/);
  assert.match(previewChat, /event\.type !== 'room\.chat\.message'[\s\S]*message\.peerId !== peerId[\s\S]*playRoomChatMessageCue\(\)/);
  assert.match(previewChat, /peerId=\{`auth-\$\{user\.id\}`\}/);
  assert.doesNotMatch(settingsModal, /settings-cue-grid|previewCue/);
  assert.match(settingsModal, /const cues = \[[\s\S]*playPeerCue\('join'\)[\s\S]*playRoomChatMessageCue\(\)[\s\S]*playFriendAcceptedCue\(\)/);
  assert.match(settingsModal, /disabled=\{previewingSoundSet\}/);
});

test('shared slider component supports custom track backgrounds and backs volume UI', () => {
  const slider = read('src/lib/shared/ui/Slider/Slider.svelte');
  const sliderTypes = read('src/lib/shared/ui/Slider/types.ts');
  const uiIndex = read('src/lib/shared/ui/index.ts');
  const settingsModal = read('src/lib/features/home/components/SettingsModal.svelte');
  const participantMenu = read('src/lib/features/room/components/ParticipantContextMenu.svelte');

  assert.match(uiIndex, /export \* from '\.\/Slider'/);
  assert.doesNotMatch(uiIndex, /VolumeSlider/);
  assert.match(slider, /class="vr-slider"/);
  assert.match(slider, /--slider-fraction/);
  assert.match(sliderTypes, /showFill\?: boolean/);
  assert.match(sliderTypes, /background\?: Snippet/);
  assert.match(slider, /\{#if background\}[\s\S]*\{@render background\(\)\}/);
  assert.match(slider, /\{#if showFill\}[\s\S]*vr-slider-fill/);
  assert.match(settingsModal, /<Slider[\s\S]*onValueChange=\{onNotificationVolumeChange\}/);
  assert.match(participantMenu, /<Slider[\s\S]*bind:value=\{volumePercent\}/);
});

test('focus styles use light border tokens instead of colored glow', () => {
  const appCss = read('src/lib/shared/styles/app.css');
  const controlsCss = read('src/lib/features/room/styles/controls.css');
  const friendsCss = read('src/lib/features/home/styles/friends.css');
  const chatCss = read('src/lib/features/room/styles/chat-rail.css');

  assert.match(appCss, /--focus-border: rgba\(255, 255, 255, 0\.72\)/);
  assert.match(appCss, /--focus-ring: color-mix\(in oklch, var\(--ink\)/);
  assert.match(controlsCss, /border-color: var\(--focus-border/);
  assert.doesNotMatch(controlsCss, /oklch\(70% 0\.14 82/);
  assert.doesNotMatch(controlsCss, /box-shadow: 0 0 0 3px var\(--focus-ring\)/);
  assert.match(friendsCss, /\.lobby-dm-input:focus[\s\S]*border-color: var\(--focus-border/);
  assert.match(chatCss, /\.chat-rail-input:focus[\s\S]*border-color: var\(--focus-border/);
});

test('chat image attachments support picker, clipboard, and drag-and-drop behind the media capability', () => {
  const composer = read('src/lib/shared/chat/AttachmentComposer.svelte');
  const uploadControl = read('src/lib/shared/chat/AttachmentUploadControl.svelte');
  const dropOverlay = read('src/lib/shared/chat/AttachmentDropOverlay.svelte');
  const composeStore = read('src/lib/shared/chat/attachment-compose.svelte.ts');
  const attachmentCss = read('src/lib/shared/chat/attachment.css');
  const roomChat = readRoomChat();
  const previewChat = readPreviewChat();
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  const friendsCss = read('src/lib/features/home/styles/friends.css');
  const chatCss = read('src/lib/features/room/styles/chat-rail.css');

  assert.match(composer, /attachment-draft[\s\S]*attachment-draft-remove/);
  assert.doesNotMatch(composer, /Переместить раньше|Переместить позже|>Удалить</);
  assert.match(uploadControl, /type="file"[\s\S]*Загрузить фото/);
  assert.match(dropOverlay, /Перетащите фото сюда/);
  assert.match(attachmentCss, /\.attachment-compose-field[\s\S]*border:[\s\S]*\.attachment-add-button[\s\S]*background: transparent/);
  assert.match(attachmentCss, /\.attachment-compose-field[\s\S]*flex-direction: column/);
  assert.match(attachmentCss, /\.attachment-compose-controls[\s\S]*align-items: flex-start/);
  assert.match(attachmentCss, /\.attachment-upload-root[\s\S]*align-self: flex-start/);
  assert.match(attachmentCss, /\.attachment-add-button \{[\s\S]*width: 32px;[\s\S]*height: 32px/);
  assert.match(attachmentCss, /\.attachment-upload-root \{[\s\S]*margin: 8px 0 0 8px/);
  assert.match(attachmentCss, /\.attachment-draft-loading[\s\S]*background: color-mix\(in srgb, var\(--warm-950\)/);
  assert.doesNotMatch(
    attachmentCss.match(/\.attachment-draft-loading \{[\s\S]*?\n\}/)?.[0] || '',
    /var\(--accent\)/
  );
  assert.match(attachmentCss, /\.attachment-draft-remove \{[\s\S]*background: var\(--coral\)/);
  assert.match(chatCss, /\.chat-compose-row \{[\s\S]*align-items: stretch/);
  assert.match(friendsCss, /\.lobby-dm-compose-row \{[\s\S]*align-items: stretch/);
  assert.match(dmView, /class="chat-msg-text dm-chat-message"/);
  assert.match(dmView, /class="dm-chat-content"/);
  assert.doesNotMatch(dmView, /lobby-dm-bubble/);
  assert.ok(
    dmView.indexOf('<AttachmentMosaic attachments={bubble.attachments} />')
      < dmView.indexOf('<span class="chat-msg-content dm-msg-content">'),
    'DM attachments render above their caption within one message'
  );
  assert.match(friendsCss, /\.dm-chat-content \{[\s\S]*display: grid;[\s\S]*max-width: min\(720px, 100%\);[\s\S]*gap: 6px/);
  assert.match(friendsCss, /\.dm-chat-content \.attachment-mosaic \{[\s\S]*width: min\(560px, 100%\)/);
  assert.match(chatCss, /\.chat-rail-compose \.attachment-upload-root \{[\s\S]*margin-top: 5px/);
  assert.match(composeStore, /imageFilesFromClipboard[\s\S]*clipboardData/);
  assert.match(composeStore, /imageFilesFromDataTransfer[\s\S]*data\.files/);
  for (const parent of [roomChat, previewChat, dmView]) {
    assert.match(parent, /getCapabilityFeature\('mediaUploads'\)/);
    assert.match(parent, /onpaste=\{onComposePaste\}/);
    assert.match(parent, /imageFilesFromClipboard\(event\)[\s\S]*media\.addFiles\(files\)/);
    assert.match(parent, /ondragenter=\{onAttachmentDragEnter\}/);
    assert.match(parent, /ondrop=\{onAttachmentDrop\}/);
    assert.match(parent, /<AttachmentUploadControl/);
    assert.match(parent, /attachment-compose-field[\s\S]*<AttachmentComposer[\s\S]*attachment-compose-controls/);
    assert.match(parent, /PinnedToBottom[\s\S]*drafts\.length[\s\S]*tick\(\)/);
  }
  assert.match(previewChat, /attachmentIds: media\?\.readyIds \?\? \[\]/);
  assert.match(previewChat, /\{#if message\.attachments\?\.length\}<AttachmentMosaic/);
});

test('desktop shell layout stays in shared web styles, not electron overrides', () => {
  const appCss = read('src/lib/shared/styles/app.css');
  const desktopShell = read('src/lib/shared/styles/desktop-shell.css');

  assert.match(appCss, /@import '\.\/desktop-shell\.css'/);
  assert.match(desktopShell, /html\.is-desktop \.lobby-shell/);
  assert.match(desktopShell, /html\.is-desktop \.room-chat-rail/);
  assert.match(desktopShell, /--voice-room-shell-topbar/);
  assert.doesNotMatch(desktopShell, /\.lobby-preview-chat/);
});

test('chat linkify keeps full URLs with hosts, paths, and query strings clickable', async () => {
  const { parseChatLinks } = await importTypeScript('src/lib/shared/utils/linkify.ts');
  const url = 'https://spb.hh.ru/vacancy/134530018?nhtmFrom=chat';

  assert.deepEqual(parseChatLinks(url), [{ kind: 'link', text: url, href: url }]);
  assert.deepEqual(parseChatLinks(`${url}.`), [
    { kind: 'link', text: url, href: url },
    { kind: 'text', text: '.' }
  ]);
  assert.deepEqual(parseChatLinks('javascript:alert(1)'), [{ kind: 'text', text: 'javascript:alert(1)' }]);
});

test('avatar presence colors are solid and cover dnd, afk, online, and offline states', () => {
  const avatar = read('src/lib/shared/ui/Avatar/Avatar.svelte');
  const presence = read('src/lib/shared/presence.ts');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  const roomTopbar = read('src/lib/features/room/components/RoomTopbar.svelte');

  assert.match(avatar, /dnd \? 'dnd' : afk \? 'afk' : online \? 'online' : 'offline'/);
  assert.match(avatar, /dnd: 'var\(--coral\)'/);
  assert.match(avatar, /afk: 'var\(--amber\)'/);
  assert.match(avatar, /online: 'var\(--green\)'/);
  assert.match(avatar, /offline: 'var\(--warm-faint\)'/);
  assert.doesNotMatch(avatar, /ui-avatar-dot--dnd::after/);
  assert.match(presence, /import type \{ PresenceStatus \} from '@voice-room\/shared\/validation'/);
  assert.match(presence, /export type \{ PresenceStatus \}/);
  assert.match(presence, /if \(!online\) return 'offline'/);
  assert.match(presence, /doNotDisturb \? 'dnd' : 'online'/);
  assert.match(sidebar, /effectivePresenceStatus\(entry\.online, entry\.user\.presenceStatus, entry\.user\.doNotDisturb\)/);
  assert.match(sidebar, /afk=\{selfPresence === 'away'\}/);
  assert.match(dmView, /effectivePresenceStatus\(online, peer\?\.presenceStatus, peer\?\.doNotDisturb\)/);
  const inviteList = read('src/lib/shared/components/room-menu/RoomInviteFriendList.svelte');
  assert.match(inviteList, /effectivePresenceStatus\(\s*friend\.online,\s*friend\.user\.presenceStatus,\s*friend\.user\.doNotDisturb\s*\)/);
});

test('effective presence gives physical offline priority and safely supports legacy payloads', async () => {
  const { effectivePresenceStatus } = await importTypeScript('src/lib/shared/presence.ts');

  assert.equal(effectivePresenceStatus(false, 'dnd', true), 'offline');
  assert.equal(effectivePresenceStatus(true, 'online'), 'online');
  assert.equal(effectivePresenceStatus(true, 'away'), 'away');
  assert.equal(effectivePresenceStatus(true, 'dnd'), 'dnd');
  assert.equal(effectivePresenceStatus(true, 'offline'), 'offline');
  assert.equal(effectivePresenceStatus(true, undefined, true), 'dnd');
  assert.equal(effectivePresenceStatus(true, 'unexpected', false), 'online');
});

test('delete realtime contracts avoid stale chat and false room affordances', () => {
  const roomChat = readRoomChat();
  const previewChat = readPreviewChat();
  const messageMenu = read('src/lib/shared/chat/MessageContextMenu.svelte');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const accountEvents = read('../api/src/realtime/account-events.js');
  const apiServer = read('../api/src/server.js');

  assert.match(apiServer, /buildServerEnvelope\('room\.chat\.deleted'/);
  assert.doesNotMatch(apiServer, /broadcast\(presence, delEvent\)/);
  assert.match(accountEvents, /case 'dm\.message\.deleted'/);
  assert.match(previewChat, /event\.type === 'room\.chat\.deleted'[\s\S]*messages = messages\.filter/);
  assert.match(friends, /case 'dm\.message\.deleted'[\s\S]*refreshFriends\(\)/);
  assert.match(messageMenu, /\{#if canDelete\}[\s\S]*label="Удалить"/);
  assert.match(roomChat, /canDelete=\{isOwnMessage\(target\)\}[\s\S]*onDelete=\{\(\) => void deleteMessage\(target\.id\)\}/);
});

test('message editing is author-only in UI and applies realtime replacements', () => {
  const roomChat = readRoomChat();
  const previewChat = readPreviewChat();
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const realtime = read('src/lib/api/realtime.ts');
  const roomsApi = read('src/lib/api/rooms.ts');
  const server = read('../api/src/server.js');
  const roomOwnership = functionBody(roomChat, 'isOwnMessage');
  const previewOwnership = functionBody(previewChat, 'isOwnMessage');
  const messageMenu = read('src/lib/shared/chat/MessageContextMenu.svelte');

  assert.match(server, /buildServerEnvelope\('room\.chat\.edited'/);
  assert.match(server, /type: 'dm\.message\.edited'/);
  assert.match(server, /Deliberately no owner\/moderator override/);
  assert.match(server, /authorUserId: message\.authorUserId \|\| null/);
  assert.match(roomsApi, /authorUserId: string \| null/);
  assert.match(realtime, /type: 'room\.chat\.edited'/);
  assert.match(realtime, /type: 'dm\.message\.edited'/);
  assert.match(roomChat, /event\.type === 'room\.chat\.edited'[\s\S]*messages = messages\.map/);
  assert.match(previewChat, /event\.type === 'room\.chat\.edited'[\s\S]*messages = messages\.map/);
  assert.match(friends, /case 'dm\.message\.edited'[\s\S]*applyEditedMessage/);
  assert.match(friends, /case 'ready'[\s\S]*resyncOpenThread\(\{ force: true \}\)/);
  assert.match(messageMenu, /\{#if canEdit\}[\s\S]*label="Изменить"[\s\S]*hint="E"/);
  assert.match(roomChat, /canEdit=\{isOwnMessage\(target\)\}[\s\S]*onEdit=\{\(\) => startEditing\(target\)\}/);
  for (const ownership of [roomOwnership, previewOwnership]) {
    assert.match(ownership, /message\.authorUserId === accountUserId/);
    assert.match(ownership, /message\.peerId === peerId/);
  }
  assert.match(dmView, /canEdit=\{menuFromMe\}[\s\S]*onEdit=\{\(\) => startEditing\(target\)\}/);
  for (const source of [roomChat, previewChat, dmView]) assert.match(source, /\(изменено\)/);
});

test('room surfaces share one chat panel, quotes jump, and an opened chat starts on the newest message', () => {
  const panel = read(ROOM_CHAT_PANEL_PATH);
  const rail = read('src/lib/features/room/components/RoomChat.svelte');
  const preview = read('src/lib/features/home/components/lobby/RoomPreviewChat.svelte');
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const replyBar = read('src/lib/shared/chat/ReplyTargetBar.svelte');

  // The lobby preview and the in-room rail are wrappers: neither owns chat
  // transport, so the two surfaces cannot drift apart in features again.
  assert.match(rail, /<RoomChatPanel/);
  assert.match(preview, /<RoomChatPanel/);
  for (const wrapper of [rail, preview]) {
    assert.doesNotMatch(wrapper, /fetchRoomChat|postRoomChat|MessageContextMenu|MessageHoverActions/);
  }
  assert.match(panel, /reactionsEnabled/);
  assert.match(panel, /<PinnedMessagesBar/);
  assert.match(panel, /<MentionAutocomplete/);

  // Cancelling a reply is an icon, and the quote it shows is a jump target.
  assert.match(replyBar, /aria-label="Отменить ответ"/);
  assert.match(replyBar, /<X size=/);
  assert.doesNotMatch(replyBar, />Отмена</);
  for (const source of [panel, dm]) {
    assert.match(source, /<ReplyTargetBar[\s\S]*?onjump=\{jumpToMessage\}[\s\S]*?oncancel=/);
    assert.match(source, /<ReplyPreview preview=\{\w+\.replyPreview\} interactive onjump=\{jumpToMessage\}/);
    assert.match(source, /function jumpToMessage/);
  }

  // Your own avatar and name open your own profile card.
  assert.match(panel, /canOpenProfile = \(group: ChatGroup\)/);
  assert.match(panel, /group\.self \? 'Ваш профиль'/);
  assert.match(dm, /aria-label="Ваш профиль"/);

  // Opening the chat parks it on the newest message even after late layout.
  assert.match(panel, /async function settleAtBottom/);
  assert.match(panel, /requestAnimationFrame/);
  assert.match(panel, /\} else if \(!signal\.aborted && chatVisible\) \{\s*\/\/[\s\S]*?await settleAtBottom\(\);/);
});

test('room messages stack their reactions and keep the hover toolbar clear of the author line', () => {
  const panel = read(ROOM_CHAT_PANEL_PATH);
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const css = read('src/lib/features/room/styles/chat-rail.css');
  const dmCss = read('src/lib/features/home/styles/friends.css');

  // Reactions belong under the message, left aligned, the way direct messages
  // already render them — not beside the text in the row's flex line.
  assert.match(panel, /<div class="chat-msg-body">[\s\S]*<ReactionSummary[\s\S]*<\/div>\s*<MessageHoverActions/);
  assert.match(css, /\.chat-msg-body \{[^}]*display: grid;[^}]*justify-items: start;/);
  assert.match(dm, /<div class="dm-chat-content">[\s\S]*<ReactionSummary/);
  assert.match(dmCss, /\.dm-chat-content \{ display: grid;/);

  // The row is not an isolated stacking context, so the hovered group can lift
  // the toolbar over the author line instead of trapping it behind.
  assert.doesNotMatch(css, /\.chat-msg-text \{[^}]*isolation: isolate/);
  assert.match(css, /\.chat-msg:has\(\.chat-msg-text:hover\)[\s\S]*z-index: 6/);

  // The toolbar has to survive losing :hover, or the overlay it opened steals
  // the pointer and the buttons disappear from under the cursor.
  assert.match(css, /\.chat-msg-text\.is-context \.chat-msg-actions,\s*\.chat-msg-actions\[data-overlay-open='true'\] \{ opacity: 1;/);
  assert.match(css, /\.chat-msg-meta:hover \+ \.chat-msg-text \.chat-msg-actions \{ opacity: 1;/);
  const hover = read('src/lib/shared/chat/MessageHoverActions.svelte');
  assert.match(hover, /data-overlay-open=\{pickerOpen\}/);
  assert.match(hover, /bind:open=\{pickerOpen\}/);
});

test('room menus share semantic groups and expose invite as a right-hand submenu only in voice', () => {
  const content = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const header = read('src/lib/features/home/components/lobby/RoomViewHeader.svelte');

  assert.match(content, /<PopoverSubmenu label="Пригласить"/);
  // Hover-to-open with its 120ms dwell now lives in the shared submenu primitive.
  const submenu = read('src/lib/shared/ui/Popover/PopoverSubmenu.svelte');
  assert.match(submenu, /onpointerenter=\{scheduleOpen\}/);
  assert.match(submenu, /onpointerleave=\{handlePointerLeave\}/);
  assert.match(submenu, /HOVER_DELAY_MS = 120/);
  assert.match(submenu, /\.popover-submenu::after[\s\S]*width: 12px/);
  assert.match(submenu, /use:portal/);
  assert.match(submenu, /position: fixed/);
  assert.match(submenu, /rowRect\.right \+ 10/);
  assert.match(content, /label="Скопировать код"[\s\S]*label="Скопировать ссылку"[\s\S]*Выключить уведомления[\s\S]*label="Настройки комнаты"/);
  assert.match(topbar, /inviteContent/);
  const inviteList = read('src/lib/shared/components/room-menu/RoomInviteFriendList.svelte');
  assert.match(inviteList, /В комнате/);
  assert.match(inviteList, /disabled=\{Boolean\(ringingUserId\) \|\| alreadyInRoom\}/);
  assert.doesNotMatch(header, /inviteContent/);
});

test('room invitation decisions replace the actions with a durable result in the thread', () => {
  const dmApi = read('src/lib/api/dm.ts');
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');

  assert.match(dmApi, /status: 'pending' \| 'accepted' \| 'declined' \| 'expired'/);
  assert.match(dm, /Принял приглашение/);
  assert.match(dm, /Отклонил предложение/);
  assert.match(dm, /Приглашение завершено/);
  assert.match(dm, /\{#if inviteActionable\(bubble, group\.fromMe\)\}/);
});

test('room preview includes screen-share tiles and the API preserves screen metadata', () => {
  const api = read('src/lib/api/rooms.ts');
  const preview = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const browse = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');
  const streamTile = read('src/lib/features/home/components/lobby/LobbyStreamTile.svelte');

  assert.match(api, /screen\?: boolean/);
  for (const source of [preview, browse]) {
    assert.match(source, /screenPeers/);
    assert.match(source, /<LobbyStreamTile/);
  }
  assert.match(streamTile, /data-screen="true"/);
});

test('participant focus uses a centered stage and a bounded carousel strip', () => {
  const state = read('src/lib/features/room/participants-ui.svelte.ts');
  const tile = read('src/lib/features/room/components/ParticipantTile.svelte');
  const stage = read('src/lib/features/room/components/StageTiles.svelte');
  const css = read('src/lib/features/room/styles/participants.css');

  assert.match(state, /focusedParticipantId/);
  assert.match(tile, /toggleParticipantFocus/);
  assert.match(tile, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.doesNotMatch(tile, /· вы/);
  assert.match(stage, /participant-focus-stage/);
  assert.match(stage, /participant-carousel/);
  assert.match(stage, /carousel\?\.scrollBy/);
  // The spotlight has no close X (clicking the tile again releases it), the
  // screen view reuses the same carousel, and arrows only show for overflow.
  assert.doesNotMatch(stage, /participant-focus-close/);
  assert.match(stage, /screenFocused/);
  assert.match(stage, /data-visible=\{canScrollLeft\}/);
  assert.match(stage, /data-visible=\{canScrollRight\}/);
  assert.match(css, /\.tile-grid\[data-count\]:not\(\[data-count="0"\]\)[\s\S]*align-self: center/);
  assert.match(css, /\.participant-carousel-shell[\s\S]*width: min\(100%, 790px\)/);
  assert.match(css, /\.participant-carousel-nav\[data-visible="false"\][\s\S]*visibility: hidden/);
  assert.doesNotMatch(css, /\.participant-focus-close/);
  assert.match(css, /\.participant-focus-strip \.stream-tile-actions[\s\S]*?display: none/);
  assert.match(css, /\.participant[\s\S]*cursor: pointer/);
});

test('room preview, room, and direct chats use a stable top-right message action toolbar', () => {
  const chat = readRoomChat();
  const previewChat = readPreviewChat();
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const roomCss = read('src/lib/features/room/styles/chat-rail.css');
  const dmCss = read('src/lib/features/home/styles/friends.css');
  const hoverActions = read('src/lib/shared/chat/MessageHoverActions.svelte');

  for (const source of [chat, previewChat, dm]) assert.match(source, /<MessageHoverActions/);
  assert.match(hoverActions, /class="chat-msg-actions" role="toolbar"/);
  assert.match(hoverActions, /aria-label="Копировать текст"/);
  assert.match(hoverActions, /aria-label="Ответить"/);
  assert.match(hoverActions, /aria-label="Больше действий"/);
  assert.doesNotMatch(hoverActions, /aria-label="Редактировать"|aria-label="Удалить"|aria-label="Закрепить"/);
  assert.doesNotMatch(previewChat, /chat-msg-edit-button/);
  assert.doesNotMatch(chat, /rootClass="chat-msg-menu-root"/);
  assert.match(chat, /queueMicrotask\(\(\) => openProfileCardFor\(person, anchor\)\)/);
  assert.match(chat, /onAuthorContextMenu\(group\.peerId, event\)/);
  assert.match(chat, /openParticipantContextMenu\([\s\S]*authorPeerId[\s\S]*'list'/);
  assert.match(roomCss, /\.chat-msg-text[\s\S]*width: calc\(100% \+ 45px\)/);
  assert.doesNotMatch(roomCss, /\.chat-msg::before/);
  assert.match(roomCss, /\.chat-msg-text::before[\s\S]*inset: -3px -20px/);
  assert.match(roomCss, /\.chat-msg-text\[data-group-first='true'\]::before[\s\S]*top: -25px[\s\S]*left: -45px/);
  assert.match(roomCss, /\.chat-msg-text:hover::before/);
  for (const source of [chat, previewChat]) {
    assert.match(source, /data-group-first=\{message\.id === group\.messages\[0\]\.id\}/);
  }
  // The toolbar sits fully above the message body in both chats.
  assert.match(roomCss, /\.chat-msg-actions \{[\s\S]*bottom: calc\(100% - 6px\)[\s\S]*right: -12px[\s\S]*opacity: 0/);
  assert.match(roomCss, /\.chat-msg-text:hover \.chat-msg-actions/);
  assert.match(dm, /data-group-first=\{bubble\.id === group\.bubbles\[0\]\.id\}/);
  assert.doesNotMatch(dmCss, /\.dm-msg-actions|\.lobby-dm-bubble/);
  assert.match(roomCss, /\.chat-msg-actions \{[^}]*overflow: visible/);
});

test('composer ArrowUp edits the latest own message in both chats', () => {
  const chat = readRoomChat();
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');

  for (const source of [chat, dm]) {
    assert.match(source, /key === 'ArrowUp' && !draft\.trim\(\) && !editingMessageId/);
    assert.match(source, /findLastOwnMessage/);
  }
});

test('message action toolbars expose persisted quick reactions and a separated full picker', () => {
  const chat = readRoomChat();
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const picker = read('src/lib/shared/chat/ReactionPicker.svelte');
  const persistence = read('src/lib/shared/chat/frequent-reactions.ts');
  const hoverActions = read('src/lib/shared/chat/MessageHoverActions.svelte');

  assert.match(chat, /<MessageHoverActions[\s\S]*reactionStore=\{reactionsEnabled && session\.user\?\.id \? reactions : undefined\}[\s\S]*userId=\{session\.user\?\.id\}/);
  assert.match(dm, /<MessageHoverActions[\s\S]*reactionStore=\{reactionsEnabled \? reactions : undefined\}[\s\S]*userId=\{selfId\}/);
  assert.match(hoverActions, /\{#if reactionStore && userId\}[\s\S]*<ReactionPicker/);
  assert.match(hoverActions, /showQuickReactions=\{false\}/);
  assert.match(picker, /showQuickReactions = true/);
  assert.match(picker, /\{#if showQuickReactions\}/);
  assert.ok(hoverActions.indexOf('<ReactionPicker') < hoverActions.indexOf('aria-label="Ответить"'));
  assert.match(picker, /class="reaction-quick-actions" role="group" aria-label="Быстрые реакции"/);
  assert.match(picker, /\{#each frequentEmoji as emoji/);
  assert.match(picker, /SmilePlus/);
  assert.match(picker, /placeholder="Поиск реакции"/);
  const catalog = read('src/lib/shared/chat/emoji-catalog.ts');
  // Categories now come through the catalogue layer, which drops anything the
  // artwork cannot draw before the picker ever sees it.
  assert.match(picker, /listBrowsableCategories/);
  assert.match(catalog, /listReactionEmojiGroups/);
  assert.match(catalog, /import coverage from '\.\/emoji-coverage\.json'/);
  assert.match(catalog, /function isOfferedEmoji\(emoji: string\): boolean/);
  // Categories are anchors into one continuous list, not tabs that swap the
  // content out, so scrolling passes from one category into the next.
  assert.match(picker, /class="reaction-picker-anchors"[\s\S]*role="toolbar"/);
  assert.match(picker, /aria-label="Разделы реакций"/);
  assert.match(picker, /function goToSection\(key: string\)/);
  assert.doesNotMatch(picker, /role="tablist"|role="tabpanel"/);
  // ~2400 tiles in one scroller, so only the visible rows may exist.
  assert.match(picker, /const visibleRows = \$derived\.by/);
  assert.match(picker, /style:height=\{`\$\{layout\.totalHeight\}px`\}/);
  // Skin tones are a choice, not 1565 extra tiles: a remembered default plus a
  // long press for a one-off, which leaves the default alone.
  assert.match(picker, /BROWSABLE_EMOJIS/);
  assert.match(picker, /saveSkinTone\(tone, SKIN_TONES\.length\)/);
  // A dwell or a right click reaches the swatches; there is no hold-to-open,
  // and no close button — leaving the strip or pressing elsewhere puts it away.
  assert.match(picker, /TONE_HOVER_DELAY_MS = 300/);
  assert.match(picker, /function beginToneHover\(emoji: string, event: PointerEvent\)/);
  assert.match(picker, /oncontextmenu=/);
  assert.match(picker, /function dismissOverlays\(event: PointerEvent\)/);
  // The swatches have to be reachable: leaving the tile only starts a grace
  // period, and entering the strip cancels it outright.
  assert.match(picker, /TONE_CLOSE_GRACE_MS = \d+/);
  assert.match(picker, /function scheduleToneClose\(\)/);
  assert.match(picker, /onpointerenter=\{cancelToneClose\}/);
  // And it has to stay inside the panel, which clips whatever hangs out.
  assert.match(picker, /toneStripLeft = Math\.min\(/);
  assert.match(picker, /pickerBox\.width - half - TONE_STRIP_MARGIN/);
  assert.doesNotMatch(picker, /beginLongPress|reaction-tone-strip-close/);
  // The jump is instant: an animated one walked the window through every row in
  // between and asked for the artwork of each.
  assert.doesNotMatch(picker, /behavior: 'smooth'/);
  assert.match(picker, /scroller\.scrollTop = top;/);
  // The category strip stays one line and the grid keeps the height that the
  // preview bar used to take: it only ever repeated the emoji under the cursor.
  assert.match(picker, /\.reaction-picker-anchors \{ display: flex; flex-wrap: nowrap;/);
  assert.doesNotMatch(picker, /reaction-picker-foot|reaction-picker-hint|previewEmoji/);
  assert.match(persistence, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(persistence, /voice-room:frequent-reactions/);
  assert.match(persistence, /frequentReactionKey\(namespace: string, userId: string\)/);
  assert.match(persistence, /readLocalStorage\(key\)/);
});

test('manual chat polish keeps notifications local, direct messages flat, reactions compact, and mentions login-bound', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const roomChat = readRoomChat();
  const chatCss = read('src/lib/features/room/styles/chat-rail.css');
  const picker = read('src/lib/shared/chat/ReactionPicker.svelte');
  const summary = read('src/lib/shared/chat/ReactionSummary.svelte');
  const mentionComposer = read('src/lib/shared/chat/mention-composer.svelte.ts');
  const mentionAutocomplete = read('src/lib/shared/chat/MentionAutocomplete.svelte');
  const membership = read('src/lib/features/home/model/room-membership.svelte.ts');

  const downloadIndex = sidebar.indexOf('<SidebarDownload />');
  const notificationIndex = sidebar.indexOf('class="lobby-gear lv-notification-button"');
  const settingsIndex = sidebar.indexOf('title="Настройки"');
  assert.ok(downloadIndex >= 0 && downloadIndex < notificationIndex && notificationIndex < settingsIndex);
  assert.match(sidebar, /notificationUnreadCount > 99 \? '99\+' : notificationUnreadCount/);
  assert.doesNotMatch(lobby, /notification-inbox-trigger/);

  assert.match(dm, /class="chat-msg dm-chat-group"/);
  assert.match(dm, /class="chat-msg-text dm-chat-message"/);
  assert.match(dm, /class="chat-msg-avatar"/);
  assert.match(dm, /class="chat-msg-main"/);
  assert.doesNotMatch(dm, /lobby-dm-bubble|row-reverse/);
  const hoverActions = read('src/lib/shared/chat/MessageHoverActions.svelte');
  assert.match(hoverActions, /aria-label="Ответить"[\s\S]*<Reply/);
  for (const source of [dm, roomChat]) assert.match(source, /<MessageHoverActions/);

  assert.match(chatCss, /\.chat-msg-actions \{[^}]*overflow: visible/);
  assert.match(picker, /\.reaction-quick-trigger, \.reaction-picker-trigger \{[^}]*width: 36px; height: 36px/);
  assert.match(picker, /placement="top-start"[\s\S]*flip[\s\S]*aria-label="Открыть выбор эмодзи"[\s\S]*onclick=\{toggle\}/);
  assert.match(summary, /\.reaction-chip \{[^}]*height: 26px;[^}]*border-radius: 8px/);
  assert.match(summary, /placement="top-start"[\s\S]*flip/);
  assert.match(summary, /\.reaction-count \{[^}]*min-width: 20px;[^}]*font-family: var\(--font-mono\);[^}]*font-variant-numeric: tabular-nums/);

  assert.match(mentionComposer, /return `@\$\{member\.login\}`/);
  assert.doesNotMatch(mentionComposer, /return `@\$\{member\.displayName/);
  assert.match(roomChat, /if \(mentionComposer\.query !== query\) return/);
  assert.match(membership, /const requestGeneration = \+\+entry\.requestGeneration/);
  assert.match(membership, /if \(requestGeneration !== entry\.requestGeneration\) return/);
  assert.match(mentionAutocomplete, /bottom: calc\(100% - 8px\)/);
  assert.match(chatCss, /\.chat-rail-compose \{[\s\S]*position: relative/);
});

test('frequent reaction ranking is user-scoped, deterministic, and limited to three choices', async () => {
  const { frequentReactionKey, rankFrequentReactions } = await importTypeScript('src/lib/shared/chat/frequent-reactions.ts');

  assert.equal(frequentReactionKey('chat', 'user-42'), 'chat:user-42');
  assert.deepEqual(
    rankFrequentReactions([
      { emoji: '👍', count: 2, lastUsedAt: 10 },
      { emoji: '😂', count: 4, lastUsedAt: 5 },
      { emoji: '🔥', count: 4, lastUsedAt: 12 },
      { emoji: '❤️', count: 1, lastUsedAt: 20 }
    ]).map((entry) => entry.emoji),
    ['🔥', '😂', '👍']
  );
});

test('sidebar call widget shows only the room call timer from the server clock', () => {
  const widget = read('src/lib/features/home/components/lobby/VoiceCallWidget.svelte');
  const timer = read('src/lib/features/room/components/RoomCallTimer.svelte');
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  const session = read('src/lib/features/room/voice-session.svelte.ts');
  const room = read('src/lib/features/room/client/room/room.ts');
  const realtime = read('src/lib/api/realtime.ts');

  assert.match(widget, /voice-timers/);
  assert.match(widget, /<RoomCallTimer variant="sidebar" \/>/);
  assert.match(topbar, /<RoomCallTimer \/>[\s\S]*class="room-panel-tabs room-panel-tabs--topbar"/);
  assert.match(timer, /formatElapsed/);
  assert.match(timer, /voiceSession\.roomActiveSince/);
  assert.doesNotMatch(timer, />звонок</);
  assert.doesNotMatch(widget, /voiceSession\.joinedAt|Ваше время в звонке/);
  assert.match(session, /roomActiveSince: number \| null/);
  assert.match(room, /setVoiceSessionTiming\(\{\s*joinedAt: localPeer\?\.joinedAt/);
  assert.match(realtime, /voiceActiveSince\?: number \| null/);
});

test('room preview header drops the live badge — the stage already shows who is in', () => {
  const preview = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const browse = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');
  const css = read('src/lib/features/home/styles/friends.css');

  assert.doesNotMatch(preview, /в эфире/);
  assert.doesNotMatch(browse, /в эфире/);
  assert.doesNotMatch(css, /lobby-roomview-state/);
});

test('room chats re-stamp the current profile when the room broadcasts a peer update', () => {
  const chat = readRoomChat();
  const previewChat = readPreviewChat();
  const previewCss = read('src/lib/features/home/styles/friends.css');

  assert.match(chat, /event\.type === 'room\.peer\.updated'/);
  assert.match(chat, /authorUserId === peer\.accountUserId/);
  assert.match(chat, /name: peer\.name \|\| message\.name/);
  assert.match(chat, /avatarUrl: peer\.avatarUrl/);
  assert.match(previewChat, /event\.type === 'room\.peer\.updated'/);
  assert.match(previewChat, /authorUserId === peer\.accountUserId/);
  assert.match(previewChat, /name: peer\.name \|\| message\.name/);
  assert.match(previewCss, /\.lobby-preview-stage \.stage-strip\s*\{\s*grid-template-rows: minmax\(0, 1fr\)/);
});

test('room chat date bubbles stay pinned per day section and replace each other while scrolling', () => {
  const chat = readRoomChat();
  const css = read('src/lib/features/room/styles/chat-rail.css');

  assert.match(chat, /class="chat-day-section"/);
  assert.match(chat, /class="chat-day-divider" role="separator"/);
  assert.match(css, /\.chat-day-section[\s\S]*position: relative/);
  assert.match(css, /\.chat-day-divider[\s\S]*position: sticky[\s\S]*top: 8px/);
  assert.match(css, /\.chat-day-divider span[\s\S]*border-radius: 999px/);
  assert.doesNotMatch(css, /\.chat-day-divider::before/);
});

test('profile cover accent reuses the server-derived avatarAccent, not a client recompute', () => {
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const css = read('src/lib/features/home/styles/friends.css');

  assert.doesNotMatch(dm, /extractProfileAccent/);
  assert.match(dm, /profileAccent = \$derived\(peer\?\.avatarAccent \|\| ''\)/);
  assert.match(dm, /style:--profile-cover-accent/);
  assert.match(css, /background: var\(--profile-cover-accent/);
});

test('settings keep profile identity and sound columns free of decorative card surfaces', () => {
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const css = read('src/lib/features/home/styles/settings.css');
  const notificationListRule = css.match(/\.settings-notification-list\s*\{(?<body>[^}]*)\}/);

  assert.match(settings, /class="settings-profile-head"/);
  assert.doesNotMatch(settings, /settings-profile-(?:summary|cover|identity)/);
  assert.doesNotMatch(css, /\.settings-sound-device\s*\{[^}]*(?:background|border|padding):/);
  assert.ok(notificationListRule?.groups?.body);
  assert.doesNotMatch(notificationListRule.groups.body, /(?:background|border|padding)\s*:/);
  assert.doesNotMatch(notificationListRule.groups.body, /max-height|overflow-y/);
});

test('settings sound columns cannot widen the modal content area', () => {
  const css = read('src/lib/features/home/styles/settings.css');
  const contentRule = css.match(/\.settings-content\s*\{(?<body>[^}]*)\}/);
  const soundRule = css.match(/\.settings-sound\s*\{(?<body>[^}]*)\}/);
  const devicesRule = css.match(/\.settings-sound-devices\s*\{(?<body>[^}]*)\}/);

  assert.ok(contentRule?.groups?.body);
  assert.match(contentRule.groups.body, /overflow-x:\s*hidden/);
  assert.ok(soundRule?.groups?.body);
  assert.match(soundRule.groups.body, /min-width:\s*0/);
  assert.match(soundRule.groups.body, /max-width:\s*100%/);
  assert.ok(devicesRule?.groups?.body);
  assert.match(devicesRule.groups.body, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(devicesRule.groups.body, /min-width:\s*0/);
  assert.match(devicesRule.groups.body, /max-width:\s*100%/);
  assert.match(css, /\.settings-sound-device \.popover-root[\s\S]*width:\s*100%[\s\S]*max-width:\s*100%/);
});

test('release polish shares dialog focus trapping across modal surfaces', () => {
  const focusTrap = read('src/lib/shared/ui/focus-trap.ts');
  const dialog = read('src/lib/shared/ui/Dialog/Dialog.svelte');
  const avatarCrop = read('src/lib/shared/ui/AvatarCropDialog/AvatarCropDialog.svelte');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const lobbyRoomSettings = read('src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte');
  const roomSettings = read('src/lib/features/room/components/RoomSettingsDialog.svelte');

  assert.match(focusTrap, /FOCUSABLE_SELECTOR/);
  assert.match(focusTrap, /event\.key !== 'Tab'/);
  assert.match(focusTrap, /opener\?\.isConnected/);
  assert.match(focusTrap, /function suspend\(\): void/);
  assert.match(focusTrap, /!root\.contains\(activeElement\)/);
  for (const source of [dialog, avatarCrop, settings, lobbyRoomSettings, roomSettings]) {
    assert.match(source, /dialogFocusTrap/);
    assert.match(source, /tabindex="-1"/);
    assert.match(source, /data-dialog-initial-focus/);
  }
});

test('popover menus and create-room tabs expose honest keyboard semantics', () => {
  const popover = read('src/lib/shared/ui/Popover/Popover.svelte');
  const createRoom = read('src/lib/features/home/components/CreateRoomDialog.svelte');
  const lobbyCss = read('src/lib/features/home/styles/lobby-v2.css');

  assert.match(popover, /role !== 'menu'/);
  assert.match(popover, /if \(!open \|\| role !== 'menu'\) return;\s*focusMenuItem\(0\)/);
  assert.match(popover, /querySelectorAll<HTMLElement>\('\[role="menuitem"\]'\)/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.match(popover, new RegExp(`event\\.key === '${key}'`));

  assert.match(createRoom, /role="tablist" aria-label="Тип комнаты" tabindex="-1" onkeydown=\{onTabsKeydown\}/);
  assert.match(createRoom, /initialFocus="#createRoomPermanentTab"/);
  assert.match(createRoom, /aria-controls="createRoomPermanentPanel"/);
  assert.match(createRoom, /aria-controls="createRoomTempPanel"/);
  assert.match(createRoom, /role="tabpanel"/);
  assert.match(createRoom, /tabindex=\{tab === 'permanent' \? 0 : -1\}/);
  assert.match(createRoom, /tabindex=\{tab === 'temp' \? 0 : -1\}/);
  assert.match(lobbyCss, /\.lr-dialog-form/);
});

test('release polish removes token drift, inline people styles, and adds reduced-motion and hit-area baselines', () => {
  const layout = read('src/routes/+layout.svelte');
  const appCss = read('src/lib/shared/styles/app.css');
  const people = read('src/lib/features/home/components/lobby/PeopleView.svelte');
  const lobbyCss = read('src/lib/features/home/styles/lobby-v2.css');
  const switchCss = read('src/lib/shared/ui/Switch/Switch.svelte');
  const sliderCss = read('src/lib/shared/ui/Slider/Slider.svelte');
  const reactions = read('src/lib/shared/chat/ReactionPicker.svelte');
  const chatCss = read('src/lib/features/room/styles/chat-rail.css');
  const dmCss = read('src/lib/features/home/styles/friends.css');
  const roomControlsCss = read('src/lib/features/room/styles/controls.css');
  const settingsCss = read('src/lib/features/home/styles/settings.css');

  assert.match(layout, /font-family: var\(--font-ui\)/);
  assert.equal((appCss.match(/--focus-border:/g) || []).length, 1);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(appCss, /transition-duration: 0\.001ms !important/);
  assert.doesNotMatch(people, /\sstyle="/);
  assert.match(lobbyCss, /\.people-request-copy/);
  assert.match(lobbyCss, /\.people-truncate/);
  assert.match(switchCss, /\.ui-switch::after[\s\S]*inset: -10px -4px/);
  assert.match(sliderCss, /\.vr-slider-control[\s\S]*height: 36px/);
  assert.match(reactions, /\.reaction-picker-grid button[\s\S]*height: 44px/);
  assert.match(chatCss, /\.chat-msg-actions > button[\s\S]*width: 36px;[\s\S]*height: 36px/);
  assert.doesNotMatch(dmCss, /\.dm-msg-actions/);
  assert.match(roomControlsCss, /\.gate-switch::after[\s\S]*inset: -12px -6px/);
  assert.match(settingsCss, /\.settings-switch::after[\s\S]*inset: -10px -4px/);
});

test('context-menu follow-up preserves async feedback, focus scopes, guest boundaries, and unblock recovery', () => {
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const profileUi = read('src/lib/features/home/profile-card-ui.svelte.ts');
  const contextMenu = read('src/lib/shared/ui/ContextMenu/ContextMenu.svelte');
  const submenu = read('src/lib/shared/ui/Popover/PopoverSubmenu.svelte');
  const participantMenu = read('src/lib/features/room/components/ParticipantContextMenu.svelte');
  const pinned = read('src/lib/features/room/components/PinnedMessagesBar.svelte');
  const messageMenu = read('src/lib/shared/chat/MessageContextMenu.svelte');
  const roomMenu = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');
  const blocks = read('src/lib/api/blocks.ts');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');

  assert.match(dm, /pushToast\('Сообщение удалено'\)/);
  assert.match(profileUi, /rect: Pick<DOMRect, 'left' \| 'bottom'>/);
  assert.match(profileUi, /explicit\?\.restoreFocus \?\? element/);
  assert.match(contextMenu, /role === 'dialog' \|\| ownsNavigation/);
  assert.match(contextMenu, /activeScope && activeScope !== panel/);
  assert.match(submenu, /use:portal/);
  assert.match(submenu, /position:\s*fixed/);
  assert.match(submenu, /ariaHaspopup="menu"/);
  assert.match(submenu, /rightSpace >= panelRect\.width/);
  assert.match(participantMenu, /role="dialog"/);
  assert.match(participantMenu, /\{#if peer\.accountUserId\}[\s\S]*label="Профиль"/);
  assert.match(pinned, /\{#if canUnpin\}[\s\S]*aria-label="Открепить сообщение"/);
  assert.match(messageMenu, /hint="E"/);
  assert.match(messageMenu, /hint="⌫"/);
  assert.match(messageMenu, /handleShortcut/);
  assert.match(roomMenu, /stillCurrent\(targetRoomId\)/);
  assert.match(blocks, /export async function fetchBlockedUsers/);
  assert.match(settings, /Заблокированные пользователи/);
  assert.match(settings, /unblockBlockedUser\(blocked\.id\)/);
  assert.doesNotMatch(blocks, /login:\s*id/);
});

test('chat hover actions stay compact, float the picker, and open profiles from messages and members', () => {
  const hover = read('src/lib/shared/chat/MessageHoverActions.svelte');
  const picker = read('src/lib/shared/chat/ReactionPicker.svelte');
  const popover = read('src/lib/shared/ui/Popover/Popover.svelte');
  const roomChat = readRoomChat();
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const members = read('src/lib/features/home/components/lobby/RoomMemberList.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const profileHost = read('src/lib/features/home/components/profile-card/ProfileCardHost.svelte');
  const messageMenu = read('src/lib/shared/chat/MessageContextMenu.svelte');

  assert.match(hover, /chat-msg-actions-divider/);
  assert.match(hover, /aria-label="Ответить"/);
  assert.match(hover, /aria-label="Копировать текст"/);
  assert.match(hover, /aria-label="Больше действий"/);
  assert.doesNotMatch(hover, /Редактировать|Удалить|Закрепить/);
  assert.match(picker, /\bflip\b[\s\S]*\bfloating\b/);
  assert.match(popover, /class:popover-panel--floating=\{floating\}/);
  assert.match(popover, /\.popover-root \{[^}]*display: grid;/);
  assert.match(popover, /style:--popover-available-height/);
  assert.match(roomChat, /openUserProfile[\s\S]*roomMessageProfilePerson/);
  assert.match(dm, /openMessageAuthorProfile[\s\S]*openProfileCardFor/);
  assert.match(members, /class="room-member-list__member"[\s\S]*openMemberProfile/);
  assert.match(profileHost, /person\.userId === session\.user\?\.id[\s\S]*\? 'self'/);
  assert.ok(messageMenu.indexOf('action?.();') < messageMenu.indexOf('close();'));
  assert.doesNotMatch(sidebar, /aria-haspopup="menu"/);
});
