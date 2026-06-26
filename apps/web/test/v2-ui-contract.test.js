import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(topbar, /import Popover from '\$lib\/shared\/components\/Popover\.svelte'/);
  assert.match(topbar, /<h1 class="room-heading-title-wrap">/);
  assert.match(topbar, /room-heading-trigger/);
  assert.match(topbar, /Скопировать код/);
  assert.match(topbar, /keepContentMounted/);
  assert.match(topbar, /room-heading-popover-head/);
  assert.match(topbar, /roomPopoverEmojiBadge/);
  assert.match(topbar, /roomPopoverTitle/);
  assert.doesNotMatch(topbar, /copyCodeButton|copyLinkButton|room-settings-button/);

  const roomView = read('src/lib/features/room/client/room/room.ts');
  assert.match(roomView, /document\.querySelector\('#roomCodeText'\)/);
  assert.match(roomView, /roomPopoverEmojiBadge/);
  assert.doesNotMatch(roomView, /elements\.roomCodeText/);

  const select = read('src/lib/shared/components/Select.svelte');
  assert.match(select, /import Ellipsis from '\$lib\/shared\/components\/Ellipsis\.svelte'/);

  const dock = read('src/lib/features/room/components/RoomDock.svelte');
  assert.match(dock, /dock-anchor/);
  assert.match(dock, /flip/);
  const controls = read('src/lib/features/room/styles/controls.css');
  assert.match(controls, /\.device-popover[\s\S]*overflow:\s*visible/);
  assert.match(controls, /\.dock-anchor/);
  assert.match(controls, /\.device-popover[\s\S]*left:\s*50%/);
  assert.match(controls, /translateX\(-50%\)/);

  const selectCss = read('src/lib/shared/styles/select.css');
  assert.match(selectCss, /\.select-trigger--dock \.select-trigger-chevron[\s\S]*right:\s*11px/);
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
  const select = read('src/lib/shared/components/Select.svelte');
  const selectCss = read('src/lib/shared/styles/select.css');
  const topbarDownload = read('src/lib/features/home/components/TopbarDownload.svelte');
  const settingsModal = read('src/lib/features/home/components/SettingsModal.svelte');
  const roomDock = read('src/lib/features/room/components/RoomDock.svelte');
  const devices = read('src/lib/features/room/client/ui/devices.ts');

  assert.match(select, /import Popover from '\$lib\/shared\/components\/Popover\.svelte'/);
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
  assert.match(select, /tabindex=\{index === activeIndex \? 0 : -1\}/);
  assert.match(selectCss, /\.select-trigger/);
  assert.match(topbarDownload, /import Select from '\$lib\/shared\/components\/Select\.svelte'/);
  assert.match(settingsModal, /import Select from '\$lib\/shared\/components\/Select\.svelte'/);
  assert.match(roomDock, /import Select from '\$lib\/shared\/components\/Select\.svelte'/);
  assert.doesNotMatch(topbarDownload, /<select\b/);
  assert.doesNotMatch(settingsModal, /<select\b/);
  assert.doesNotMatch(roomDock, /<select\b/);
  assert.doesNotMatch(devices, /deviceSelect|noiseModeSelect|outputDeviceSelect/);
});

test('popover placement flips vertically only when the preferred side would overflow', () => {
  const placement = read('src/lib/shared/components/popover-placement.ts');

  assert.match(placement, /export function resolvePopoverPlacement/);
  assert.match(placement, /panelRect\.bottom > viewportHeight - margin/);
  assert.match(placement, /if \(spaceAbove > spaceBelow\) return flipPlacementVertical/);
});

test('shared Popover primitive exposes trigger/content slots and dismiss behavior', () => {
  const popover = read('src/lib/shared/components/Popover.svelte');
  const popoverCss = read('src/lib/shared/styles/popover.css');
  const userMenu = read('src/lib/features/home/components/UserMenu.svelte');

  assert.match(popover, /trigger: Snippet<\[PopoverTriggerState\]>/);
  assert.match(popover, /content: Snippet<\[PopoverContentState\]>/);
  assert.match(popover, /\{@render trigger\(triggerState\)\}/);
  assert.match(popover, /\{@render content\(contentState\)\}/);
  assert.match(popover, /onpointerdown=\{onWindowPointerDown\}/);
  assert.match(popover, /requestClose\('escape'\)/);
  assert.match(popover, /script lang="ts" module/);
  assert.match(popover, /popoverPanelCounter/);
  assert.match(popover, /focusTrigger/);
  assert.match(popover, /data-placement=\{resolvedPlacement\}/);
  assert.match(popover, /resolvePopoverPlacement/);
  assert.match(popover, /openWithPlacement/);
  assert.match(popover, /flip = false/);
  assert.match(popoverCss, /\.popover-panel/);
  assert.match(popoverCss, /\.popover-menu-item/);
  assert.match(popoverCss, /\.popover-option/);
  assert.match(userMenu, /import Popover from '\$lib\/shared\/components\/Popover\.svelte'/);
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

test('screen stream thumbnails show profile metadata instead of an action button', () => {
  const overlays = read('src/lib/features/room/components/RoomOverlays.svelte');
  const screenStageControls = read('src/lib/features/room/client/ui/screen-stage-controls.ts');
  const refs = read('src/lib/features/room/client/model/participants.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const screenTiles = read('src/lib/features/room/client/ui/screen-tile-elements.ts');
  const screenView = read('src/lib/features/room/client/ui/screen-view.ts');
  const participantsCss = read('src/lib/features/room/styles/participants.css');
  const streamTilesCss = read('src/lib/features/room/styles/stream-tiles.css');

  assert.doesNotMatch(overlays, /participant-screen-meta/);
  assert.doesNotMatch(refs, /screenMeta: HTMLElement/);
  assert.doesNotMatch(participants, /refreshParticipantScreenMeta/);
  assert.match(participants, /node\.addEventListener\('click'/);
  assert.match(participantsCss, /\.participant\[data-screen="true"\] \.participant-screen-action\s*\{\s*display: none;/s);
  assert.match(screenTiles, /createStreamTileProfileMeta/);
  assert.match(screenTiles, /stream-tile-profile-meta/);
  assert.match(screenTiles, /parseScreenProfileId/);
  assert.match(screenTiles, /SCREEN_QUALITY_OPTIONS/);
  assert.match(screenTiles, /SCREEN_FPS_OPTIONS/);
  assert.doesNotMatch(screenTiles, /stream-tile-action-disconnect/);
  assert.doesNotMatch(screenTiles, /Отключиться/);
  assert.match(screenView, /participant\.isLocal \? state\.localScreenProfileId : participant\.screenProfileId/);
  assert.match(streamTilesCss, /\.stream-tile-profile-meta/);
  assert.doesNotMatch(streamTilesCss, /stream-tile-action-disconnect/);
});

test('screen stage viewer badge renders viewer avatars instead of names', () => {
  const stage = read('src/lib/features/room/components/ScreenStage.svelte');
  const controls = read('src/lib/features/room/client/ui/screen-stage-controls.ts');
  const css = read('src/lib/features/room/styles/screen.css');

  assert.match(stage, /screen-meta-viewers/);
  assert.match(controls, /renderScreenViewers/);
  assert.match(controls, /createScreenViewerAvatar/);
  assert.match(controls, /getAvatarColor\(viewer\.avatarColorKey\)/);
  assert.match(controls, /getInitials\(viewer\.name\)/);
  assert.doesNotMatch(controls, /screen-meta-viewers-label/);
  assert.doesNotMatch(controls, /formatScreenViewersLine/);
  assert.doesNotMatch(controls, /names\.join/);
  assert.match(css, /\.screen-meta-viewer-avatar/);
  assert.doesNotMatch(css, /screen-meta-viewers-label/);
});

test('room route checks /auth/me and blocks anonymous entry on guest-name modal', () => {
  const roomRoute = read('src/routes/r/[roomId]/+page.svelte');
  const roomRouteOptions = read('src/routes/r/[roomId]/+page.ts');
  const roomPage = read('src/lib/features/room/RoomPage.svelte');
  const roomMain = read('src/lib/features/room/client/main.ts');
  const roomView = read('src/lib/features/room/client/room/room.ts');
  const names = read('src/lib/features/room/client/ui/names.ts');
  const dom = read('src/lib/features/room/client/ui/dom.ts');
  const overlays = read('src/lib/features/room/components/RoomOverlays.svelte');
  const screenStageControls = read('src/lib/features/room/client/ui/screen-stage-controls.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const showRoomRoute = functionBody(roomView, 'showRoomRoute');
  const resolveRoomEntryName = functionBody(roomView, 'resolveRoomEntryName');
  const requestGuestNameForRoom = functionBody(names, 'requestGuestNameForRoom');
  const handleGuestNameSubmit = functionBody(names, 'handleGuestNameSubmit');

  assert.match(roomRoute, /import RoomPage from '\$lib\/features\/room\/RoomPage\.svelte'/);
  assert.match(roomRouteOptions, /export const ssr = false/);
  assert.match(roomPage, /mountRoomClient\(roomRoot\)/);
  assert.match(roomMain, /showRoomRoute\(\)/);
  assert.match(roomMain, /showStartScreen\(\)/);
  assert.match(roomMain, /bindGuestNameDialog\(\)/);
  assert.match(roomMain, /resetGuestNameDialog/);
  assert.match(roomMain, /unbindGuestNameDialog/);
  assert.match(roomMain, /new AbortController\(\)/);
  assert.match(roomMain, /listenerSignal/);
  assert.match(roomMain, /mountAbortController\?\.abort\(\)/);
  assert.match(roomMain, /bindScreenStageIdleUi\(listenerSignal\)/);
  assert.match(roomMain, /mounted = false/);
  assert.doesNotMatch(roomRoute, /HomePage|loadSession|authLoadError|LobbyPage/);
  assert.doesNotMatch(roomPage, /loadSession|authLoadError|LobbyPage/);
  assert.match(home, /auth-session-error/);

  assert.match(roomView, /import \{ fetchMe, fetchOwnedRooms \} from '\$lib\/api\/auth'/);
  assert.match(roomView, /import \{ roomNameFor \} from '\$lib\/features\/auth\/account'/);
  assert.match(roomView, /type RoomEntryGateResult = 'authenticated' \| 'anonymous' \| 'failure'/);
  assert.match(showRoomRoute, /const exists = await checkRoomExists\(state\.roomId\)/);
  assert.ok(showRoomRoute.indexOf('showRoomNotFound()') < showRoomRoute.indexOf('resolveRoomEntryName()'));
  assert.match(showRoomRoute, /const entryGate = await resolveRoomEntryName\(\)/);
  assert.match(showRoomRoute, /if \(entryGate === 'failure'\) return/);
  assert.ok(showRoomRoute.indexOf('resolveRoomEntryName()') < showRoomRoute.indexOf('showRoomScreen()'));
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
  assert.match(dom, /get guestNameDialog\(\)/);
  assert.match(dom, /get guestNameForm\(\)/);
  assert.match(dom, /get guestNameInput\(\)/);
  assert.match(dom, /get guestNameError\(\)/);
  assert.match(names, /pendingGuestNamePromise/);
  assert.match(screenStageControls, /bindScreenStageIdleUi\(signal\?: AbortSignal\)/);
  assert.match(screenStageControls, /resetScreenStageIdleUi/);
  assert.match(screenStageControls, /screenUiHoverBound = false/);
  assert.match(screenStageControls, /signal\?\.addEventListener\('abort'/);
  assert.match(names, /resetGuestNameDialog/);
  assert.match(names, /unbindGuestNameDialog/);
  assert.match(names, /rejectPendingGuestName/);
  assert.match(names, /setGuestNameSiblingInert/);
  assert.match(names, /closest\('\.app-shell'\)/);
  assert.match(names, /child\.contains\(elements\.guestNameDialog\)/);
  assert.match(names, /child\.setAttribute\('inert', ''\)/);
  assert.match(names, /child\.removeAttribute\('inert'\)/);
  assert.match(names, /handleGuestNameDialogKeydown/);
  assert.match(names, /event\.key === 'Escape'[\s\S]*guestNameInput\.focus\(\)/);
  assert.match(names, /event\.key !== 'Tab'/);
  assert.match(names, /handleGuestNameDialogClick/);
  assert.match(requestGuestNameForRoom, /setGuestNameDialogOpen\(true\)/);
  assert.match(requestGuestNameForRoom, /guestNameInput\.focus\(\)/);
  assert.match(handleGuestNameSubmit, /cleanDisplayName\(elements\.guestNameInput\.value\)/);
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
