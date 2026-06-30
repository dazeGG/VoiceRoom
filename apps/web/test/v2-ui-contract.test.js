import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(resolve(root, path), 'utf8');

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

  assert.match(lobby, /roomNavigation\.viewedRoomId/);
  assert.match(lobby, /connectedRoomIsViewed\(friendsState\.mode\)/);
  assert.match(lobby, /embeddedRoomIsVisible\(friendsState\.mode\)/);
  assert.match(roomNavigation, /viewedRoomId: string \| null/);
  assert.match(roomNavigation, /embeddedRoomId: string \| null/);
  assert.match(roomNavigation, /joinIntentRoomId: string \| null/);
  assert.match(roomNavigation, /export function getActiveVoiceRoomId/);
  assert.match(roomNavigation, /Room-navigation state machine/);
  assert.match(roomNavigation, /viewedRoomId mirrors the URL-level room preview/);
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
  assert.match(enterRoom, /selectRoomForVoiceEntry\(roomId\)/);
  assert.match(roomNavigation, /roomNavigation\.embeddedRoomId = roomId/);
  assert.match(roomNavigation, /roomNavigation\.joinIntentRoomId = roomId/);
  assert.match(enterRoom, /friendsState\.mode = 'rooms'/);
  assert.match(closeViewedRoom, /const transition = routeToHome\(\)/);
  assert.match(closeViewedRoom, /if \(transition\.closeEmbeddedRoom\) closeEmbeddedRoom\(\{ replaceUrl: false \}\)/);
  assert.match(closeViewedRoom, /history\.pushState\(null, '', '\/'\)/);
  assert.match(lobby, /function closeEmbeddedRoom\(\{ replaceUrl = true, closedRoomId = embeddedRoomId \}/);
  assert.match(lobby, /replaceUrl && closedRoomId && selectedRoomId === closedRoomId/);
  assert.doesNotMatch(lobby, /!closedRoomId \|\| selectedRoomId === closedRoomId/);
  assert.match(onEmbeddedLeave, /event instanceof CustomEvent/);
  assert.match(onEmbeddedLeave, /event\.detail\?\.roomId/);
  assert.match(onEmbeddedLeave, /const closedViewedRoom = Boolean\(closedRoomId && selectedRoomId === closedRoomId\)/);
  assert.match(onEmbeddedLeave, /closeEmbeddedRoom\(\{ closedRoomId \}\)/);
  assert.match(onEmbeddedLeave, /if \(closedViewedRoom\) clearViewedRoom\(\)/);
  assert.match(leaveConnectedVoiceRoom, /const leavingRoomId = connectedVoiceRoomId/);
  assert.match(leaveConnectedVoiceRoom, /leaveActiveVoiceRoom\(\)/);
  assert.match(leaveConnectedVoiceRoom, /resolveLeaveViewedConnectedRoom\(leavingRoomId\)/);
  assert.match(leaveConnectedVoiceRoom, /closeEmbeddedRoom\(\)/);
  assert.ok(
    leaveConnectedVoiceRoom.indexOf('closeEmbeddedRoom()') < leaveConnectedVoiceRoom.indexOf('clearViewedRoom()'),
    'sidebar leave restores URL before clearing the viewed room'
  );
  assert.match(lobby, /<RoomBrowseView \{user\} room=\{selectedRoom\} onEnter=\{\(\) => enterRoom\(selectedRoom\.roomId\)\}/);
  assert.match(lobby, /dataset\.lobbyEmbedded = 'true'/);
  assert.match(lobby, /delete document\.body\.dataset\.lobbyEmbedded/);
  assert.match(browseView, /const requestedRoomId = room\.roomId/);
  assert.match(browseView, /if \(room\.roomId !== requestedRoomId\) return/);
  assert.match(browseView, /let loadError = \$state\(''\)/);
  assert.match(browseView, /Не удалось загрузить участников/);
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
  const chat = read('src/lib/features/room/components/RoomChat.svelte');
  const topbar = read('src/lib/features/room/components/RoomTopbar.svelte');

  assert.match(stage, /<RoomChat \/>/);
  assert.match(ui, /unreadChat: 0/);
  assert.match(ui, /incrementUnreadChat/);
  assert.match(chat, /messageIds/);
  assert.match(chat, /incrementUnreadChat\(\)/);
  assert.match(topbar, /room-chat-unread/);
  assert.match(topbar, /import \{[^}]*\bPopover\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(topbar, /<h1 class="room-heading-title-wrap">/);
  assert.match(topbar, /room-heading-trigger/);
  assert.match(topbar, /Скопировать код/);
  assert.match(topbar, /keepContentMounted/);
  assert.match(topbar, /room-heading-popover-head/);
  assert.match(topbar, /room-heading-popover-badge/);
  assert.match(topbar, /room-heading-popover-info/);
  assert.doesNotMatch(topbar, /copyCodeButton|copyLinkButton|room-settings-button/);

  // Heading (title/code/emoji) is rendered reactively from room state, not written
  // imperatively by the vanilla client. The plain `.ellipsis` spans are gone.
  assert.match(topbar, /import \{ state \} from '\.\.\/client\/core\/state\.svelte'/);
  assert.match(topbar, /const heading = \$derived\(state\.roomName \|\| state\.roomId\)/);
  assert.match(topbar, /<Ellipsis text=\{heading\} title=\{heading\} class="room-heading-title"/);
  assert.match(topbar, /<Ellipsis text=\{state\.roomId\}/);
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
  const chat = read('src/lib/features/room/components/RoomChat.svelte');
  const lifecycle = read('src/lib/features/room/client/room/lifecycle.ts');

  assert.match(lifecycle, /export function applyRoomNotFound/);
  assert.match(chat, /applyRoomNotFound/);
  assert.match(chat, /payload\?\.type === 'room-not-found'[\s\S]*applyRoomNotFound\(payload\.roomId\)[\s\S]*stream\.close\(\)/);
  assert.match(chat, /payload\?\.type === 'room-deleted'[\s\S]*applyRoomDeleted\(payload\.roomId\)[\s\S]*stream\.close\(\)/);
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
  const userMenu = read('src/lib/features/home/components/UserMenu.svelte');

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
  assert.match(userMenu, /import \{[^}]*\bPopover\b[^}]*\} from '\$lib\/shared\/ui'/);
  assert.match(userMenu, /\{#snippet trigger\(/);
  assert.match(userMenu, /\{#snippet content\(/);
  assert.match(userMenu, /aria-haspopup="menu"/);
});

test('visual identity UI consumes backend keys and exposes only curated room presets', () => {
  const authApi = read('src/lib/api/auth.ts');
  const roomsApi = read('src/lib/api/rooms.ts');
  const tokens = read('src/lib/visual/tokens.ts');
  const userMenu = read('src/lib/features/home/components/UserMenu.svelte');
  const roomCard = read('src/lib/features/home/components/RoomCard.svelte');
  const createDialog = read('src/lib/features/home/components/CreateRoomDialog.svelte');
  const participantTile = read('src/lib/features/room/components/ParticipantTile.svelte');
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
  assert.match(participantTile, /getAvatarPresentation\(participant\)/);
  assert.doesNotMatch(participantTile, /hashStringToHue\(seed\)/);
  assert.match(chat, /getAvatarColor\(message\.avatarColorKey\)/);
  assert.doesNotMatch(chat, /hashStringToHue/);
  assert.match(roomNet, /status\?\.roomIconKey/);
  // The room heading consumes the curated preset reactively in RoomTopbar now.
  const roomTopbar = read('src/lib/features/room/components/RoomTopbar.svelte');
  assert.match(roomTopbar, /getRoomPreset/);
  assert.match(roomView, /updateParticipant\(\{ \.\.\.message\.peer, isLocal: true \}\)/);
  assert.match(tokens, /ROOM_ICON_EMOJIS/);
  assert.match(tokens, /ROOM_COLOR_TOKENS/);
  assert.match(tokens, /key: '',/);
  assert.doesNotMatch(roomCard, /room\.emoji \|\| visual\.emoji/);
  assert.doesNotMatch(roomView, /state\.roomEmoji \|\| roomVisual\.emoji/);
  assert.ok(tokens.indexOf('if (hasIconKey || hasColorKey)') < tokens.indexOf('item.emoji === value.emoji'));
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
  assert.match(topbar, /hidden=\{connection\.stateName === 'idle' \|\| state\.screen !== 'room'\}/);
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

  assert.match(css, /\.participant\[data-speaking="true"\]/);
  assert.match(css, /border-color: var\(--green\)/);
  assert.match(css, /\.participant\[data-speaking="true"\] \.voice-ring/);
  assert.doesNotMatch(css, /\.participant\[data-local="true"\]\s*\{\s*border-color/s);
  assert.match(participants, /participant\.speaking = nextSpeaking/);
  assert.match(participants, /refreshParticipantState\(\)/);
  assert.match(participants, /bumpParticipantsRevision\(\)/);
  assert.match(participantTile, /data-speaking=\{String\(participant\.speaking\)\}/);
  assert.match(meters, /setParticipantSpeaking\(participant, isLocalMicrophoneSpeaking/);
  assert.match(livekit, /RoomEvent\.ActiveSpeakersChanged/);
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

test('screen stage viewer badge renders viewer avatars instead of names', () => {
  const stage = read('src/lib/features/room/components/ScreenStage.svelte');
  const screenUi = read('src/lib/features/room/screen-ui.svelte.ts');
  const css = read('src/lib/features/room/styles/screen.css');

  assert.match(stage, /screen-meta-viewers/);
  assert.match(stage, /getViewerAvatarStyle/);
  assert.match(stage, /getViewerInitials/);
  assert.match(screenUi, /getViewerAvatarStyle/);
  assert.match(screenUi, /getAvatarPresentation\(viewer\)/);
  assert.doesNotMatch(screenUi, /screen-meta-viewers-label/);
  assert.doesNotMatch(screenUi, /formatScreenViewersLine/);
  assert.doesNotMatch(screenUi, /names\.join/);
  assert.match(css, /\.screen-meta-viewer-avatar/);
  assert.doesNotMatch(css, /screen-meta-viewers-label/);
});

test('room route uses lobby for authenticated users and preserves standalone guest entry', () => {
  const roomRoute = read('src/routes/r/[roomId]/+page.svelte');
  const roomRouteOptions = read('src/routes/r/[roomId]/+page.ts');
  const roomPage = read('src/lib/features/room/RoomPage.svelte');
  const roomMain = read('src/lib/features/room/client/main.ts');
  const roomView = read('src/lib/features/room/client/room/room.ts');
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

  assert.match(roomView, /import \{ fetchMe, fetchOwnedRooms \} from '\$lib\/api\/auth'/);
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
  assert.match(resolveRoomEntryName, /persistName\(roomNameFor\(user\)\)/);
  assert.match(resolveRoomEntryName, /return 'authenticated'/);
  assert.match(resolveRoomEntryName, /return 'failure'/);
  assert.match(resolveRoomEntryName, /await requestGuestNameForRoom\(\)/);
  assert.match(resolveRoomEntryName, /Guest name request cancelled/);
  assert.match(resolveRoomEntryName, /return 'anonymous'/);
  assert.doesNotMatch(resolveRoomEntryName, /loadSession|showRoomScreen|autoJoinRoom|showRoomNotFound/);
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
  const entry = read('src/lib/features/home/components/EntryCard.svelte');
  const roomsApi = read('src/lib/api/rooms.ts');
  const authApi = read('src/lib/api/auth.ts');

  assert.match(home, /<EntryCard[\s\S]*onCreateTemp=\{handleCreateTemp\}[\s\S]*onJoin=\{handleJoinRoom\}/);
  assert.match(home, /const showLobby = \$derived\(session\.loaded && Boolean\(user\)\)/);
  assert.match(home, /function handleJoinRoom\(\): void[\s\S]*openRoom\(roomId\)/);
  assert.match(home, /async function handleCreateTemp\(\): Promise<void>[\s\S]*createRoom\(\{ isStatic: false \}\)/);
  assert.match(entry, /Без регистрации/);
  assert.match(entry, /или войдите по коду/);
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
  assert.match(subscriptionSetter, /publication\.isSubscribed === subscribed/);
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

test('hotfix lobby UX keeps dock in main area, preview chat, and add-friend submit flow', () => {
  const controls = read('src/lib/features/room/styles/controls.css');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const previewView = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const browseView = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');
  const previewChat = read('src/lib/features/home/components/lobby/RoomPreviewChat.svelte');
  const addFriend = read('src/lib/features/home/components/lobby/AddFriendView.svelte');
  const friendsCss = read('src/lib/features/home/styles/friends.css');

  assert.match(controls, /body\[data-lobby-embedded="true"\] \.room-dock/);
  assert.match(controls, /left: var\(--lobby-sidebar-width, 312px\)/);
  assert.match(sidebar, /import SidebarDownload from '\.\.\/SidebarDownload\.svelte'/);
  assert.match(sidebar, /<SidebarDownload \/>/);
  assert.match(previewView, /RoomPreviewChat/);
  assert.match(browseView, /RoomPreviewChat/);
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
  assert.match(previewChat, /fetchRoomChat\(roomId\)/);
  assert.match(previewChat, /postRoomChat\(roomId/);
  assert.match(previewChat, /chat-rail-collapse/);
  assert.match(previewView, /previewChatOpen/);
  assert.match(browseView, /previewChatOpen/);
  assert.match(addFriend, /copyText\(user\.login\)/);
  assert.doesNotMatch(addFriend, /searchUsers/);
  assert.doesNotMatch(addFriend, /oninput=\{onInput\}/);
  assert.match(addFriend, /@daze/);
  assert.match(friendsCss, /\.lobby-preview-chat/);
  assert.match(friendsCss, /data-preview-chat-open/);
  assert.match(friendsCss, /\.lobby-dm-head[\s\S]*border: 0/);
  assert.match(lobby, /import '\$lib\/features\/room\/styles\/chat-rail\.css'/);
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

test('remote participant audio preferences persist volume and local mute separately', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const settings = read('src/lib/features/room/client/core/settings.ts');
  const playback = read('src/lib/features/room/client/services/media-playback-service.ts');
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
  assert.match(functionBody(playback, 'applyRemoteParticipantAudioPreferences'), /isVoicePlaybackMuted\(\) \|\| preference\.muted \|\| preference\.volume <= 0/);
  assert.match(functionBody(playback, 'applyRemoteParticipantAudioPreferences'), /applyVoiceMediaElementVolume\(audio, \{ muted, volume: preference\.volume \}\)/);
  const outputSyncBody = functionBody(playback, 'syncAudioOutputDevices');
  assert.match(outputSyncBody, /syncRemoteAudioPlayback\(\)/);
  assert.ok(
    outputSyncBody.indexOf('syncRemoteAudioPlayback()') < outputSyncBody.indexOf('applyAudioOutputDevice(mediaElement)'),
    'remote voice gains must be downgraded before applying output sink ids'
  );
  assert.match(playback, /const voiceAudioGains = new WeakMap<HTMLMediaElement, VoiceAudioGain>\(\)/);
  assert.match(playback, /export function releaseRemoteAudioElement\(mediaElement: HTMLMediaElement\)/);
  assert.match(playback, /function applyVoiceMediaElementVolume[\s\S]*existing && maxVolume > 1[\s\S]*existing\.gain\.gain\.value = options\.muted \? 0 : volume/);
  assert.match(playback, /function applyVoiceMediaElementVolume[\s\S]*if \(existing\) \{[\s\S]*releaseRemoteAudioElement\(mediaElement\)/);
  assert.match(playback, /function applyVoiceMediaElementVolume[\s\S]*mediaElement\.volume = Math\.min\(1, volume\)/);

  assert.match(participants, /applyRemoteParticipantAudioPreferences\(peer\)/);
  assert.match(participants, /const hadAccountUserId = participant\.accountUserId/);
  assert.match(participants, /participant\.accountUserId !== hadAccountUserId[\s\S]*applyRemoteParticipantAudioPreferences\(participant\)/);
  assert.match(participants, /releaseRemoteAudioElement\(audio\)/);
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
  assert.match(tile, /tabindex=\{participant\.isLocal \? undefined : 0\}/);
  assert.match(tile, /aria-haspopup=\{participant\.isLocal \? undefined : 'dialog'\}/);
  assert.match(tile, /openParticipantContextMenu\(participant\.id/);

  assert.match(menu, /const canUseSocialActions = \$derived/);
  assert.match(menu, /getFriendRelationship\(peer\.accountUserId\)/);
  assert.match(menu, /Написать сообщение/);
  assert.match(menu, /Принять заявку/);
  assert.match(menu, /Заявка в друзья уже отправлена/);
  assert.match(menu, /Добавить в друзья/);
  assert.match(menu, /Гость: доступны только локальные настройки звука/);

  assert.match(menu, /min="0"/);
  assert.match(menu, /max="200"/);
  assert.match(menu, /storeParticipantAudioPreference\(preferenceKey, \{ volume: safePercent \/ 100 \}\)/);
  assert.match(menu, /muted: !getParticipantAudioPreference\(preferenceKey\)\.muted/);
  assert.match(menu, /applyRemoteParticipantAudioPreferences\(peer\)/);

  assert.match(menu, /role="dialog"/);
  assert.match(menu, /document\.addEventListener\('keydown', handleKeydown/);
  assert.match(menu, /document\.addEventListener\('pointerdown', handlePointerDown, \{ capture: true \}\)/);
  assert.match(menu, /document\.addEventListener\('focusin', handleFocusIn\)/);
  assert.match(contextUi, /restoreFocusPeerId/);
  assert.match(contextUi, /queueMicrotask\(\(\) => focusParticipantTile/);
  assert.match(menu, /activeElement instanceof HTMLInputElement && activeElement\.type === 'range'/);
  assert.match(menu, /event\.key === 'ArrowDown' && !isRangeInput/);
  assert.match(menu, /event\.key === 'ArrowUp' && !isRangeInput/);
  assert.match(participants, /closeParticipantContextMenu\(peerId\)/);
  assert.match(room, /closeParticipantContextMenu\(\)/);
  assert.match(menu, /closeParticipantContextMenu\(peer\.id\)/);
  assert.match(menu, /addFriendByUserId\(peer\.accountUserId\)/);
  assert.match(menu, /acceptRequestByUserId\(peer\.accountUserId\)/);
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  assert.match(functionBody(friends, 'initLobby'), /Promise\.all\(\[refreshFriends\(\), refreshRequests\(\)\]\)/);
  assert.match(functionBody(friends, 'getFriendRelationship'), /requests\.incoming\.some/);
  assert.match(functionBody(friends, 'getFriendRelationship'), /requests\.outgoing\.some/);
  assert.match(menu, /setMode\('friends'\)/);
  assert.match(menu, /await openDm\(peer\.accountUserId\)/);
  assert.match(menu, /showToast\('Не удалось отправить заявку в друзья', \{ variant: 'error' \}\)/);
  assert.match(menu, /showToast\('Не удалось принять заявку в друзья', \{ variant: 'error' \}\)/);
  assert.match(menu, /showToast\('Не удалось открыть личные сообщения', \{ variant: 'error' \}\)/);

  assert.match(css, /\.participant-context-menu/);
  assert.match(css, /\.participant-context-menu \.participant-volume-control input[\s\S]*pointer-events:\s*auto/);
  assert.match(css, /\.participant-volume-track\[data-boosted="true"\]/);
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
