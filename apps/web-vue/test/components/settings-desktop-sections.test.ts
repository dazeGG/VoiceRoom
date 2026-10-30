// Hotkeys, the microphone mode and the app section exist only in the desktop
// app; a browser tab gets the sections it can use.

import { screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import SettingsDialog from '@/features/home/components/settings/SettingsDialog.vue';
import type { SettingsTab } from '@/features/home/components/settings/types';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';
import { stubOverlayDom } from '../helpers/overlay-dom.ts';
import { renderWithApp } from '../helpers/render.ts';

beforeEach(() => {
  stubOverlayDom();
  stubMatchMedia();
  stubFetch({});
});
afterEach(() => {
  delete window.voiceRoomRuntime;
  delete window.voiceRoomDesktopAutostart;
});

async function renderSettings(tab: SettingsTab = 'profile') {
  await renderWithApp(SettingsDialog, {
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

test('a browser tab has no hotkeys or microphone mode, and its app section offers the desktop builds', async () => {
  const nav = await renderSettings();
  expect(nav.queryByRole('button', { name: 'Горячие клавиши' })).toBeNull();
  await userEvent.click(nav.getByRole('button', { name: 'Приложение' }));
  expect(screen.getByText('macOS · Apple Silicon')).toBeTruthy();
  expect(screen.getByText('Windows · 64-bit')).toBeTruthy();

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
  const nav = await renderSettings('sound');

  expect(nav.getByRole('button', { name: 'Горячие клавиши' })).toBeTruthy();
  expect(nav.getByRole('button', { name: 'Приложение' })).toBeTruthy();
  expect(await screen.findByRole('radiogroup', { name: 'Режим микрофона' })).toBeTruthy();
});
