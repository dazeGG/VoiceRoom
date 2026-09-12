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
  assert.match(lobby, /getAppRealtime\(\)\.onSessionEnded\(\(\) => \{\s*clearSession\(\);/);
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

test('the 2.6.0 onboarding is offered once, only to accounts without codes', () => {
  const onboarding = read('src/lib/features/home/components/RecoveryCodesOnboarding.svelte');
  const model = read('src/lib/features/home/model/account-security.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  assert.match(onboarding, /dismissOnboarding\(RECOVERY_CODES_ONBOARDING_KEY\)/);
  assert.match(model, /security\.recoveryCodes\.remaining === 0\s*&& !security\.onboardingDismissed\.includes\(RECOVERY_CODES_ONBOARDING_KEY\)/);
  assert.match(lobby, /<RecoveryCodesOnboarding onCreateCodes=\{openSecuritySettings\} \/>/);
});
