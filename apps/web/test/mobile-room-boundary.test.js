import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(webRoot, file), 'utf8');

test('phones may open only the room route; home, lobby and account screens stay desktop-only', () => {
  const layout = read('src/routes/+layout.svelte');
  assert.match(layout, /const allowed = \$derived\(desktopAllowed \|\| \(roomClientAllowed && page\.route\.id === '\/r\/\[roomId\]'\)\);/);
  assert.match(layout, /\{:else if allowed\}\s*\{@render children\(\)\}/);

  const route = read('src/routes/r/[roomId]/+page.svelte');
  assert.match(route, /roomAllowed = policy\.roomClientAllowed;\s*boundaryReady = true;\s*if \(!policy\.roomClientAllowed\) return;/);
  assert.match(route, /\{:else if session\.user && desktopAllowed\}\s*<LobbyPage/, 'a signed-in phone never gets the desktop lobby');
  // The home page keeps its own desktop-only gate.
  assert.match(read('src/routes/+page.svelte'), /\{:else if desktopAllowed\}/);
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
  assert.match(responsive, /html\[data-platform-class="mobile"\] \.screen-button \{\s*display: none;/);
  assert.match(responsive, /html\[data-platform-class="mobile"\] :is\(\.mic-button, \.output-button, \.leave-button, \.screen-exit-button, \.dock-connection\) \{\s*min-width: 44px;\s*min-height: 44px;/);
  assert.match(responsive, /\.room-heading-main > \.popover-root \{\s*min-width: 0;\s*max-width: 100%;/, 'a long room name cannot widen the page');

  const slot = read('src/lib/features/room/components/RoomCtaSlot.svelte');
  assert.match(slot, /\{#if mobile && roomClientState\.joined\}[\s\S]*?<p class="room-mobile-hint" role="note">Звонок идёт, пока браузер открыт и экран включён<\/p>/);
});
