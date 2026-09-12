import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

test('the sign-in dialog recovers an account with a one-time code', () => {
  const dialog = read('src/lib/features/auth/AuthDialog.svelte');
  const home = read('src/lib/features/home/HomePage.svelte');
  const api = read('src/lib/api/auth.ts');

  assert.match(dialog, /export type AuthMode = 'login' \| 'register' \| 'recover'/);
  assert.match(dialog, /normalizeRecoveryCode\(recoveryCode\)/);
  assert.match(dialog, /recoverAccount\(\{/);
  assert.match(dialog, /autocomplete="one-time-code"/);
  assert.match(dialog, /switchMode\('recover'\)/);
  assert.match(home, /requestedMode === 'recover'/);
  assert.match(api, /authPost<[^\n]*>\('\/auth\/recover', input\)/);
});

test('an ended session stops reconnecting and signs the lobby out', () => {
  const realtime = read('src/lib/api/realtime.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  // Reconnecting after the server ended the session would only come back as a
  // guest socket, so the client hands over to the sign-out flow instead.
  assert.match(realtime, /const SESSION_ENDED_CLOSE_CODE = 4401;/);
  assert.match(realtime, /event\?\.code === SESSION_ENDED_CLOSE_CODE\) \{[\s\S]*?this\.closedByClient = true;[\s\S]*?return;/);
  // Our own sign-out and password change also close the socket; only a session
  // ended from somewhere else may sign the lobby out with its own message.
  assert.match(lobby, /onSessionEnded\(\(\) => \{[\s\S]*?if \(consumeExpectedSessionEnd\(\) \|\| !authSession\.user\) return;\s*clearSession\(\);/);
});

test('security settings list devices and show recovery codes only once', () => {
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const security = read('src/lib/features/home/components/AccountSecuritySettings.svelte');
  const codes = read('src/lib/features/home/components/RecoveryCodesDialog.svelte');

  assert.match(settings, /\{:else if tab === 'security'\}/);
  // The nested codes dialog owns focus and Escape while it is open.
  assert.match(settings, /enabled: open && !cropOpen && !securityDialogOpen/);
  assert.match(settings, /!securityDialogOpen && event\.key === 'Escape'/);
  // The settings overlay sits at z-index 60; the codes dialog must open above it.
  assert.match(codes, /\.recovery-dialog-layer :global\(\.ui-dialog-overlay\) \{\s*z-index: 100;/);

  assert.match(security, /revokeAccountSession\(session\.id\)/);
  assert.match(security, /\{#if !session\.current\}/);
  assert.match(security, /href="https:\/\/db-ip\.com"/);
  assert.match(codes, /generateRecoveryCodes\(password\)/);
  assert.match(codes, /disabled=\{!saved\}/);
});

test('the password is changed in the security tab, and our own session ends stay quiet', () => {
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const security = read('src/lib/features/home/components/AccountSecuritySettings.svelte');
  const signOut = read('src/lib/features/home/model/sign-out.ts');

  assert.doesNotMatch(settings, /changePassword|Текущий пароль/);
  assert.match(security, /autocomplete="current-password"/);
  // Both requests make the server close this device's socket with 4401.
  assert.match(security, /expectSessionEnd\(\);\s*try \{\s*await changePassword\(currentPassword, newPassword\);/);
  assert.match(signOut, /expectSessionEnd\(\);\s*try \{\s*await logout\(\);/);
});

test('what is new follows the last seen release, not recovery codes', () => {
  const dialog = read('src/lib/features/home/components/WhatsNewDialog.svelte');
  const model = read('src/lib/features/home/model/whats-new.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  assert.match(dialog, /title="Что нового в Voice Room"/);
  assert.doesNotMatch(dialog, /\d+\.\d+\.\d+/);
  assert.doesNotMatch(dialog, /recoveryCodes|RecoveryCodes/);
  assert.match(dialog, /void markWhatsNewSeen\(\)/);
  assert.match(model, /state\.current === WHATS_NEW_VERSION && hasUnseenWhatsNew\(state\.lastSeen, state\.current\)/);
  assert.match(lobby, /<WhatsNewDialog onOpenSecurity=\{\(\) => openSecuritySettings\(\)\} \/>/);
});

test('a missing recovery codes reminder sits above the rooms, snoozes and highlights the action', () => {
  const home = read('src/lib/features/home/components/lobby/VoiceHome.svelte');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const security = read('src/lib/features/home/components/AccountSecuritySettings.svelte');
  const model = read('src/lib/features/home/model/account-security.ts');

  // A plain callout like friend requests, never an overlay that blocks the lobby.
  assert.match(home, /\{#if recoveryCodesReminder\}\s*<div class="lr-callout lr-callout--split">/);
  assert.match(home, /aria-label="Напомнить через 3 дня"[\s\S]*?onclick=\{onSnoozeRecoveryCodes\}/);
  assert.match(model, /isRecoveryCodesReminderDue\(security\.recoveryCodes, security\.recoveryCodesReminder, now\)/);
  assert.match(lobby, /onOpenRecoveryCodes=\{\(\) => openSecuritySettings\('recovery-codes'\)\}/);
  assert.match(lobby, /await snoozeRecoveryCodesReminder\(\);/);
  assert.match(security, /data-highlight=\{recoveryCodesHighlighted\}/);
  assert.match(security, /\.account-security-action\[data-highlight='true'\] \{\s*animation:/);
});
