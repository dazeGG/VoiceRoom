// Hotkeys, the microphone mode and the app section exist only in the desktop
// app; a browser tab gets the sections it can use.

import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import SettingsDialog from '../../src/lib/features/home/components/settings/SettingsDialog.svelte';
import type { SettingsTab } from '../../src/lib/features/home/components/settings/types';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';

beforeEach(() => {
  stubMatchMedia();
  stubFetch({});
});
afterEach(() => {
  cleanup();
  delete window.voiceRoomRuntime;
  delete window.voiceRoomDesktopAutostart;
});

function renderSettings(tab: SettingsTab = 'profile') {
  render(SettingsDialog, {
    props: {
      tab,
      user: authUser(),
      notificationUsers: [],
      notificationRooms: [],
      loggingOut: false,
      securityHighlight: null,
      onClose: vi.fn(),
      onToast: vi.fn(),
      onLogout: vi.fn()
    }
  });
  return within(screen.getByRole('navigation', { name: 'Разделы настроек' }));
}

test('a browser tab has no hotkeys, app section or microphone mode', async () => {
  const nav = renderSettings();
  expect(nav.queryByRole('button', { name: 'Горячие клавиши' })).toBeNull();
  expect(nav.queryByRole('button', { name: 'Приложение' })).toBeNull();

  await userEvent.click(nav.getByRole('button', { name: 'Звук' }));
  expect(nav.getByRole('button', { name: 'Звук' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('radiogroup', { name: 'Режим микрофона' })).toBeNull();
  expect(screen.getByRole('slider', { name: 'Громкость микрофона' })).toBeTruthy();
});

test('the desktop app adds hotkeys, the app section and the microphone mode', async () => {
  window.voiceRoomRuntime = { isDesktop: true, platform: 'win32' };
  window.voiceRoomDesktopAutostart = {
    getSettings: vi.fn(async () => ({ enabled: false, openMinimized: false })),
    setSettings: vi.fn(async (settings: unknown) => settings)
  };
  const nav = renderSettings('sound');

  expect(nav.getByRole('button', { name: 'Горячие клавиши' })).toBeTruthy();
  expect(nav.getByRole('button', { name: 'Приложение' })).toBeTruthy();
  expect(await screen.findByRole('radiogroup', { name: 'Режим микрофона' })).toBeTruthy();
});
