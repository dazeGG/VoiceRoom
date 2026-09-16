import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveRoomCta, shouldOpenAppPrompt } from '../src/lib/features/room/room-cta.ts';

const webRoot = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(webRoot, file), 'utf8');

test('room call to action asks guests for an account and accounts in a desktop browser for the app', () => {
  const base = { joined: true, guest: false, appAvailable: true, hasUsedDesktopApp: false, dismissed: false };

  assert.equal(resolveRoomCta({ ...base, guest: true }), 'account');
  assert.equal(resolveRoomCta({ ...base, guest: true, appAvailable: false }), 'account', 'phones and Linux still get the account ask');
  assert.equal(resolveRoomCta(base), 'app');
  assert.equal(resolveRoomCta({ ...base, hasUsedDesktopApp: true }), null, 'app users never see the app ask');
  assert.equal(resolveRoomCta({ ...base, appAvailable: false }), null, 'no app ask where there is no app');
  assert.equal(resolveRoomCta({ ...base, guest: true, dismissed: true }), null);
  assert.equal(resolveRoomCta({ ...base, dismissed: true }), null);
  assert.equal(resolveRoomCta({ ...base, joined: false, guest: true }), null, 'nothing before joining voice');
});

test('the one-time app prompt waits for a quiet lobby and shows once per account', () => {
  const quiet = { appAvailable: true, hasUsedDesktopApp: false, appPromptSeen: false, otherDialogOpen: false, voiceActive: false };

  assert.equal(shouldOpenAppPrompt(quiet), true);
  assert.equal(shouldOpenAppPrompt({ ...quiet, appPromptSeen: true }), false);
  assert.equal(shouldOpenAppPrompt({ ...quiet, hasUsedDesktopApp: true }), false);
  assert.equal(shouldOpenAppPrompt({ ...quiet, appAvailable: false }), false);
  assert.equal(shouldOpenAppPrompt({ ...quiet, otherDialogOpen: true }), false);
  assert.equal(shouldOpenAppPrompt({ ...quiet, voiceActive: true }), false, 'never over a joining or live call');
});

test('signing in from a room hands the account to a reload instead of swapping the session in place', () => {
  const dialog = read('src/lib/features/auth/AuthDialog.svelte');
  assert.match(dialog, /onAuthenticated\?: \(user: AuthUser\) => Promise<void> \| void;/);
  assert.match(
    dialog,
    /async function finish\(user: AuthUser\): Promise<boolean> \{\s*if \(onAuthenticated\) \{\s*await onAuthenticated\(user\);\s*return true;\s*\}\s*setUser\(user\);\s*await goto\('\/'\);\s*return false;/
  );
  // Every path that signs in goes through finish, and a leaving page keeps submit disabled.
  assert.equal((dialog.match(/leaving = await finish\(/g) || []).length, 3);
  assert.equal((dialog.match(/if \(!leaving\) submitting = false;/g) || []).length, 2);
  assert.doesNotMatch(dialog, /setUser\(recovered\.user\)|setUser\(await restoreAccount/);

  const room = read('src/lib/features/room/client/room/room.ts');
  assert.match(
    room,
    /export async function rejoinRoomSignedIn\(roomId: string\): Promise<void> \{\s*markInAppRoomNavigation\(\);[\s\S]*?playPeerCue\('leave'\);\s*await wait\(180\);\s*leaveRoom\(\);[\s\S]*?console\.error\('\[voice-room\] guest register rejoin', error\);[\s\S]*?window\.location\.assign\(`\/r\/\$\{encodeURIComponent\(roomId\)\}`\);/
  );

  const slot = read('src/lib/features/room/components/RoomCtaSlot.svelte');
  assert.match(slot, /onAuthenticated=\{\(\) => rejoinRoomSignedIn\(roomClientState\.roomId\)\}/);
  assert.match(slot, /guest: !embedded && !session\.user/);
  assert.match(slot, /hasUsedDesktopApp: session\.user\?\.hasUsedDesktopApp \?\? false/);
  assert.match(slot, /roomClientState\.roomIsStatic\s*\?\s*'Создайте аккаунт, чтобы сохранить комнату/, 'only permanent rooms promise to be saved');
  assert.match(read('src/lib/features/room/RoomPage.svelte'), /<RoomTopbar \/>\s*<RoomCtaSlot \/>[\s\S]*<GuestLeaveScreen \/>/);
});

test('a guest leaving sees an honest leave screen, and only a permanent room is saved to the new account', () => {
  const room = read('src/lib/features/room/client/room/room.ts');
  assert.match(
    room,
    /export async function handleLeaveButtonClick\(\): Promise<void> \{\s*\/\/[^\n]*\n\s*const roomId = state\.roomId;\s*const guest = !isRoomEmbedded\(\) && !session\.user;/,
    'who was a guest is read before leaveRoom forgets it'
  );
  assert.match(room, /if \(guest && roomId\) \{\s*openGuestLeave\(roomId, state\.roomIsStatic\);\s*return;\s*\}\s*window\.location\.href = '\/';/);

  const screen = read('src/lib/features/room/components/GuestLeaveScreen.svelte');
  assert.match(screen, /\{#if guestLeaveUi\.isStatic\}\s*<p>[^<]*вернётесь сюда без ссылки/);
  assert.match(screen, /\{:else\}\s*<p>С аккаунтом у вас будут свои постоянные комнаты, друзья и личные сообщения\.<\/p>/);
  assert.match(screen, /if \(guestLeaveUi\.isStatic && guestLeaveUi\.roomId\) \{\s*try \{\s*await addRoomByCode\(guestLeaveUi\.roomId\);/);
  assert.match(screen, /onAuthenticated=\{afterAccountCreated\}/);

  const api = read('src/lib/features/room/client/net/api.ts');
  assert.match(api, /state\.roomIsStatic = status\?\.isStatic === true;/);
});

test('the lobby opens the app prompt once, after other dialogs and outside calls, and records it', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  assert.match(lobby, /otherDialogOpen: loginAlertOpen \|\| whatsNewOpen,\s*voiceActive: Boolean\(connectedVoiceRoomId \|\| roomNavigation\.joinIntentRoomId\)/);
  assert.match(lobby, /appPromptAvailable = shouldOfferOpenInApp\(readOpenInAppSignals\(\)\);/);
  assert.match(lobby, /function closeAppPrompt\(\): void \{\s*appPromptOpen = false;\s*appPromptDone = true;\s*void markAppPromptSeen\(\)/);
  assert.match(lobby, /onOpenChange=\{\(open\) => \(whatsNewOpen = open\)\}/);
  assert.match(lobby, /<AppBenefitsModal open=\{appPromptOpen\} onClose=\{closeAppPrompt\} \/>/);

  const story = read('src/lib/features/home/components/WhatsNewDialog.svelte');
  assert.match(story, /\$effect\(\(\) => \{\s*onOpenChange\?\.\(open\);\s*\}\);/);

  const benefits = read('src/lib/features/home/components/AppBenefitsModal.svelte');
  assert.match(benefits, /startDownload = createDesktopDownload\(\);/);
  for (const feature of ['Оверлей поверх игр', 'Горячие клавиши и Push-to-talk', 'Запуск вместе с системой', 'Уведомления на рабочем столе']) {
    assert.match(benefits, new RegExp(feature));
  }
});
