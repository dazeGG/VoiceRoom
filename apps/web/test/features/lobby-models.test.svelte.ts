// The lobby's room list and account prompts.

import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { LobbyRooms } from '../../src/lib/features/home/model/lobby-rooms.svelte';
import { AccountPrompts } from '../../src/lib/features/home/model/account-prompts.svelte';
import type { OwnedRoom } from '../../src/lib/api/auth';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';

function room(roomId: string, peers: number, name = roomId): OwnedRoom {
  return { roomId, name, createdAt: 1, avatarUrl: null, isStatic: true, relationship: 'owner', peers };
}

afterEach(() => vi.restoreAllMocks());

test('the room list loads, names rooms, and counts a leave before the refetch', async () => {
  const onError = vi.fn();
  let answer = [room('a', 2, 'Кухня')];
  stubFetch({ 'GET /api/auth/rooms': () => ({ body: { ok: true, rooms: answer } }) });
  const rooms = new LobbyRooms(onError);

  await rooms.refresh();
  expect(rooms.find('a')?.peers).toBe(2);
  expect(rooms.label('a')).toBe('Кухня');
  expect(rooms.label('missing')).toBe('missing');

  answer = [room('a', 1, 'Кухня')];
  rooms.left('a');
  expect(rooms.find('a')?.peers).toBe(1);
  expect(onError).not.toHaveBeenCalled();
});

test('a failed room fetch empties the list and reports why', async () => {
  const onError = vi.fn();
  stubFetch({ 'GET /api/auth/rooms': { status: 500, body: { ok: false, error: 'boom', code: 'internal' } } });
  const rooms = new LobbyRooms(onError);
  await rooms.refresh();
  expect(rooms.list).toEqual([]);
  expect(onError).toHaveBeenCalledOnce();
});

test('the app prompt waits for the other dialogs and a quiet call, and opens once', () => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  stubFetch({});
  let voiceActive = true;
  let prompts!: AccountPrompts;
  const stop = $effect.root(() => {
    prompts = new AccountPrompts({
      user: () => authUser({ hasUsedDesktopApp: false, appPromptSeen: false }),
      voiceActive: () => voiceActive,
      onToast: vi.fn()
    });
  });
  try {
    prompts.loginAlertOpen = true;
    prompts.start();
    flushSync();
    expect(prompts.appPromptOpen).toBe(false);

    prompts.loginAlertOpen = false;
    flushSync();
    expect(prompts.appPromptOpen).toBe(false);

    voiceActive = false;
    prompts.whatsNewOpen = true;
    flushSync();
    prompts.whatsNewOpen = false;
    flushSync();
    expect(prompts.appPromptOpen).toBe(true);

    prompts.closeAppPrompt();
    flushSync();
    expect(prompts.appPromptOpen).toBe(false);
  } finally {
    stop();
  }
});

test('settings open on a tab, and security opens with what to highlight', () => {
  stubFetch({});
  let prompts!: AccountPrompts;
  const stop = $effect.root(() => {
    prompts = new AccountPrompts({ user: () => null, voiceActive: () => false, onToast: vi.fn() });
  });
  try {
    prompts.openSecuritySettings('recovery-codes');
    expect([prompts.settingsOpen, prompts.settingsTab, prompts.securityHighlight]).toEqual([
      true,
      'security',
      'recovery-codes'
    ]);
    prompts.closeSettings();
    expect([prompts.settingsOpen, prompts.securityHighlight]).toEqual([false, null]);
    prompts.openSettings();
    expect(prompts.settingsTab).toBe('profile');
  } finally {
    stop();
  }
});
