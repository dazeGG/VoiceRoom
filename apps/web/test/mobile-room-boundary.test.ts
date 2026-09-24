import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(resolve(webRoot, file), 'utf8');

test('phones may open the room route and `/`; the lobby and account screens stay desktop-only', () => {
  const layout = read('src/routes/+layout.svelte');
  assert.match(layout, /const MOBILE_ROUTES = \['\/r\/\[roomId\]', '\/'\];/);
  assert.match(layout, /const allowed = \$derived\(desktopAllowed \|\| \(roomClientAllowed && MOBILE_ROUTES\.includes\(page\.route\.id \?\? ''\)\)\);/);
  assert.match(layout, /\{:else if allowed\}\s*\{@render children\(\)\}/);

  const route = read('src/routes/r/[roomId]/+page.svelte');
  assert.match(route, /roomAllowed = policy\.roomClientAllowed;\s*boundaryReady = true;\s*if \(!policy\.roomClientAllowed\) return;/);
  assert.match(route, /\{:else if session\.user && desktopAllowed\}\s*<LobbyPage/, 'a signed-in phone never gets the desktop lobby');
});

test('`/` on a phone offers a temporary room instead of the desktop-only wall', () => {
  const home = read('src/routes/+page.svelte');
  assert.match(home, /\{:else if desktopAllowed\}\s*<HomePage \/>/, 'a desktop still gets the full home page');
  assert.match(home, /\{:else if roomClientAllowed\}\s*<MobileStartScreen/);

  const screen = read('src/lib/features/home/components/MobileStartScreen.svelte');
  assert.match(screen, /createRoom\(\{ isStatic: false \}\)/, 'a phone creates a temporary room, joined as a guest');
  assert.doesNotMatch(screen, /isStatic: true/);
  assert.match(screen, /window\.location\.href = `\/r\/\$\{encodeURIComponent\(roomId\)\}`/);
});

test('the realtime socket opens on a phone only for a mounted room page, and push stays blocked', () => {
  const boundary = read('src/lib/platform/desktop-boundary.ts');
  assert.match(boundary, /export function isRealtimeBlocked\(\): boolean \{\s*return isDesktopBoundaryBlocked\(\) && !\(roomRouteActive && isRoomClientAllowed\(\)\);\s*\}/);

  const realtime = read('src/lib/api/realtime.ts');
  assert.equal((realtime.match(/if \(isRealtimeBlocked\(\)\)/g) || []).length, 3);
  assert.doesNotMatch(realtime, /isDesktopBoundaryBlocked/);

  const push = read('src/lib/features/home/model/push-notifications.svelte.ts');
  assert.match(push, /isDesktopBoundaryBlocked\(\)/);
  assert.doesNotMatch(push, /isRealtimeBlocked|isRoomClientAllowed/);

  const page = read('src/lib/features/room/RoomPage.svelte');
  assert.match(
    page,
    /if \(!policy\.roomClientAllowed\) return;[\s\S]*?setRoomRouteActive\(true\);[\s\S]*?void import\('\.\/client\/main'\)/,
    'the page is marked active before the room client can open the socket'
  );
  assert.match(page, /setRoomEmbedded\(false\);\s*setRoomRouteActive\(false\);/);
  assert.match(read('src/lib/features/room/client/main.ts'), /if \(!isRoomClientAllowed\(\)\) return \(\) => \{\};/);
});

test('phones hide screen capture, keep 44px dock targets and are told how long the call lasts', () => {
  const responsive = read('src/lib/features/room/styles/responsive.css');
  // The whole cluster, not the button: an empty flex child still spent the
  // dock's gap and pushed the divider off-centre.
  assert.match(responsive, /html\[data-platform-class="mobile"\] \.dock-cluster--screen \{\s*display: none;/);
  assert.match(read('src/lib/features/room/components/RoomDock.svelte'), /class="dock-cluster dock-cluster--screen"/);
  assert.match(responsive, /html\[data-platform-class="mobile"\] :is\(\.mic-button, \.output-button, \.leave-button, \.screen-exit-button, \.dock-connection\) \{\s*min-width: 44px;\s*min-height: 44px;/);
  assert.match(responsive, /\.room-heading-main > \.popover-root \{\s*min-width: 0;\s*max-width: 100%;/, 'a long room name cannot widen the page');

  const slot = read('src/lib/features/room/components/RoomCtaSlot.svelte');
  assert.match(slot, /\{#if mobile && roomClientState\.joined\}[\s\S]*?<p class="room-mobile-hint" role="note">Звонок идёт, пока браузер открыт и экран включён<\/p>/);
});

test('the in-room heading keeps one row on a phone and the tabs keep a 40px target', () => {
  const responsive = read('src/lib/features/room/styles/responsive.css');
  // Stacking dropped the call timer and the panel tabs into a second line under
  // the room name, where they read as a stray block over the stage.
  assert.match(responsive, /\.room-heading\.topbar-room-heading \{\s*align-items: center;\s*flex-direction: row;/);
  assert.match(responsive, /html\[data-platform-class="mobile"\] :is\(\.room-panel-tabs--topbar, \.chat-rail-head \.room-panel-tabs\) button \{\s*width: 40px;\s*height: 40px;/);
  assert.match(responsive, /html\[data-platform-class="mobile"\] \.chat-rail-collapse \{\s*width: 40px;\s*height: 40px;/);
});

test('the room panel closes with a cross on a phone and with a chevron on a desktop', () => {
  const panel = read('src/lib/features/room/components/RoomChatPanel.svelte');
  assert.match(panel, /mobile = !getDesktopBoundaryPolicy\(\)\.desktopAllowed;/);
  assert.match(
    panel,
    /aria-label=\{mobile \? 'Закрыть панель' : 'Свернуть панель'\}[\s\S]*?\{#if mobile\}\s*<X \{\.\.\.iconSm\}[\s\S]*?\{:else\}\s*<ChevronRight \{\.\.\.iconSm\}/
  );
});

test('a guest reads the room chat through the recent window, never the account-only history', () => {
  const panel = read('src/lib/features/room/components/RoomChatPanel.svelte');
  // GET /chat/history answers a guest with 401 «Room is not available», which
  // surfaced as a chat error in a room the guest can otherwise read and write.
  assert.match(panel, /historyEnabled = canPage && Boolean\(session\.user\?\.id\);/);
  assert.match(panel, /if \(historyEnabled\) await history\.open\(roomId, anchorMessageId\);\s*else await refreshMessages\(signal\);/);
});

test('the room CTA is built like the dock and its action keeps a compact button', () => {
  const slot = read('src/lib/features/room/components/RoomCtaSlot.svelte');
  assert.match(slot, /\.room-cta \{[\s\S]*?border-radius: 18px;/, 'the card shares the dock corner');
  assert.match(slot, /\.room-cta-icon \{[\s\S]*?border-radius: 13px;/, 'the icon shares the dock button corner');
  assert.match(slot, /class="compact room-cta-action"/);
  assert.match(slot, /<strong class="room-cta-title">\{copy\.title\}<\/strong>/);
  // Every cell is placed explicitly: sparse auto-placement pushed the close
  // button past the full-width action into a third row.
  assert.match(slot, /\.room-cta :global\(\.room-cta-action\) \{\s*grid-column: 1 \/ -1;\s*grid-row: 2;\s*width: 100%;/, 'the action takes its own row when narrow');
  assert.match(slot, /\.room-cta-close \{\s*grid-column: 3;\s*grid-row: 1;/, 'the close button stays beside the copy');
});
