// What a room offers next: a guest is asked for an account, an account in a
// desktop browser is offered the app, and the one-time app prompt waits.

import { expect, test } from 'vitest';
import { resolveRoomCta, shouldOpenAppPrompt } from '../../src/lib/features/room/room-cta.ts';

const base = { joined: true, guest: false, appAvailable: true, hasUsedDesktopApp: false, dismissed: false };

test('a guest in a call is asked to create an account, even where the app is available', () => {
  expect(resolveRoomCta({ ...base, guest: true })).toBe('account');
});

test('an account in a desktop browser that has not used the app is offered the app', () => {
  expect(resolveRoomCta(base)).toBe('app');
  expect(resolveRoomCta({ ...base, hasUsedDesktopApp: true })).toBeNull();
  expect(resolveRoomCta({ ...base, appAvailable: false })).toBeNull();
});

test('nothing is offered before joining the call or after closing the offer', () => {
  expect(resolveRoomCta({ ...base, guest: true, joined: false })).toBeNull();
  expect(resolveRoomCta({ ...base, guest: true, dismissed: true })).toBeNull();
});

test('the app prompt opens once, in a quiet lobby, never over a call or another dialog', () => {
  const quiet = {
    appAvailable: true,
    hasUsedDesktopApp: false,
    appPromptSeen: false,
    otherDialogOpen: false,
    voiceActive: false
  };
  expect(shouldOpenAppPrompt(quiet)).toBe(true);
  expect(shouldOpenAppPrompt({ ...quiet, appPromptSeen: true })).toBe(false);
  expect(shouldOpenAppPrompt({ ...quiet, otherDialogOpen: true })).toBe(false);
  expect(shouldOpenAppPrompt({ ...quiet, voiceActive: true })).toBe(false);
  expect(shouldOpenAppPrompt({ ...quiet, hasUsedDesktopApp: true })).toBe(false);
});
