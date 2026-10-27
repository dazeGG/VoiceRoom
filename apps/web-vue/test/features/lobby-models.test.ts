// The lobby's room list and account prompts.

import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLobbyRooms } from '../../src/features/home/model/use-lobby-rooms.ts';
import { useAccountPrompts } from '../../src/features/home/model/use-account-prompts.ts';
import type { OwnedRoom } from '../../src/api/auth';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';

function room(roomId: string, peers: number, name = roomId): OwnedRoom {
  return { roomId, name, createdAt: 1, avatarUrl: null, isStatic: true, relationship: 'owner', peers };
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

test('the room list loads, names rooms, and counts a leave before the refetch', async () => {
  const onError = vi.fn();
  let answer = [room('a', 2, 'Кухня')];
  stubFetch({ 'GET /api/auth/rooms': () => ({ body: { ok: true, rooms: answer } }) });
  const rooms = useLobbyRooms(onError);

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
  const rooms = useLobbyRooms(onError);
  await rooms.refresh();
  expect(rooms.list.value).toEqual([]);
  expect(onError).toHaveBeenCalledOnce();
});

test('the app prompt waits for the other dialogs and a quiet call, and opens once', async () => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  stubFetch({});
  let voiceActive = true;
  let lobbyDialogOpen = false;
  const scope = effectScope();
  const prompts = scope.run(() =>
    useAccountPrompts({
      user: () => authUser({ hasUsedDesktopApp: false, appPromptSeen: false }),
      voiceActive: () => voiceActive,
      lobbyDialogOpen: () => lobbyDialogOpen,
      onToast: vi.fn()
    })
  );
  if (!prompts) throw new Error('the prompts were not created');
  try {
    prompts.loginAlertOpen.value = true;
    prompts.start();
    await nextTick();
    expect(prompts.appPromptOpen.value).toBe(false);

    prompts.loginAlertOpen.value = false;
    await nextTick();
    expect(prompts.appPromptOpen.value).toBe(false);

    voiceActive = false;
    lobbyDialogOpen = true;
    prompts.whatsNewOpen.value = true;
    await nextTick();
    prompts.whatsNewOpen.value = false;
    await nextTick();
    expect(prompts.appPromptOpen.value).toBe(false);

    lobbyDialogOpen = false;
    prompts.loginAlertOpen.value = true;
    await nextTick();
    prompts.loginAlertOpen.value = false;
    await nextTick();
    expect(prompts.appPromptOpen.value).toBe(true);

    prompts.closeAppPrompt();
    await nextTick();
    expect(prompts.appPromptOpen.value).toBe(false);
  } finally {
    scope.stop();
  }
});

test('settings open on a tab, and security opens with what to highlight', () => {
  stubFetch({});
  const scope = effectScope();
  const prompts = scope.run(() =>
    useAccountPrompts({
      user: () => null,
      voiceActive: () => false,
      lobbyDialogOpen: () => false,
      onToast: vi.fn()
    })
  );
  if (!prompts) throw new Error('the prompts were not created');
  try {
    prompts.openSecuritySettings('recovery-codes');
    expect([prompts.settingsOpen.value, prompts.settingsTab.value, prompts.securityHighlight.value]).toEqual([
      true,
      'security',
      'recovery-codes'
    ]);
    prompts.closeSettings();
    expect([prompts.settingsOpen.value, prompts.securityHighlight.value]).toEqual([false, null]);
    prompts.openSettings();
    expect(prompts.settingsTab.value).toBe('profile');
    prompts.openAppearanceSettings();
    expect([prompts.settingsOpen.value, prompts.settingsTab.value]).toEqual([true, 'appearance']);
  } finally {
    scope.stop();
  }
});
