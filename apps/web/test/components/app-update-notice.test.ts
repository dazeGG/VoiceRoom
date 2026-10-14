// After a deploy an open tab shows "update available" in a corner instead of
// reloading under the user; the desktop shell's own update goes through the
// same notice, and nothing is applied during a call.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import AppUpdateNotice from '../../src/lib/features/app-update/AppUpdateNotice.svelte';
import { AppUpdate, pendingUpdate } from '../../src/lib/features/app-update/app-update.svelte.ts';
import { bindDesktopUpdate, normalizeDesktopUpdate } from '../../src/lib/platform/desktop-update.ts';

afterEach(cleanup);

type Bridge = NonNullable<Window['voiceRoomDesktopUpdate']>;

function desktopShell(state: unknown, install: Bridge['install'] = async () => {}) {
  let push: ((payload: unknown) => void) | null = null;
  const bridge: Bridge = {
    getState: async () => state,
    onState: (handler) => {
      push = handler;
      return () => {
        push = null;
      };
    },
    install: vi.fn(install)
  };
  vi.stubGlobal('voiceRoomDesktopUpdate', bridge);
  return { bridge, push: (payload: unknown) => push?.(payload) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a downloaded desktop shell wins over a web update: its restart brings both', () => {
  expect(pendingUpdate(false, null)).toBe('none');
  expect(pendingUpdate(true, null)).toBe('web');
  expect(pendingUpdate(true, { status: 'downloading', version: '1.5.0' })).toBe('web');
  expect(pendingUpdate(false, { status: 'ready', version: '1.5.0' })).toBe('app');
  expect(pendingUpdate(true, { status: 'ready', version: '1.5.0' })).toBe('app');
});

test('nothing shows while the app is current', () => {
  render(AppUpdateNotice, { update: new AppUpdate({ webUpdated: () => false }), inCall: false });
  expect(screen.queryByRole('status')).toBeNull();
});

test('a new web version is applied by a reload when the user asks', async () => {
  const reload = vi.fn();
  render(AppUpdateNotice, { update: new AppUpdate({ webUpdated: () => true, reload }), inCall: false });

  expect(screen.getByRole('status').textContent).toContain('Доступно обновление');
  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));

  expect(reload).toHaveBeenCalledOnce();
});

test('during a call the notice only says the update waits for the call to end', () => {
  render(AppUpdateNotice, { update: new AppUpdate({ webUpdated: () => true, reload: vi.fn() }), inCall: true });

  expect(screen.getByRole('status').textContent).toContain('после звонка');
  expect(screen.queryByRole('button')).toBeNull();
});

test('a desktop shell with a downloaded release restarts into it instead of reloading the page', async () => {
  const { bridge } = desktopShell({ status: 'ready', version: '1.5.0' });
  const reload = vi.fn();
  const update = new AppUpdate({ webUpdated: () => true, reload });
  const unbind = update.bind();
  await flush();
  render(AppUpdateNotice, { update, inCall: false });

  expect(screen.getByRole('status').textContent).toContain('Новая версия приложения');
  await userEvent.click(screen.getByRole('button', { name: 'Перезапустить' }));

  expect(bridge.install).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  unbind();
});

test('if the shell cannot restart, a reload still brings the new web app', async () => {
  desktopShell({ status: 'ready', version: '1.5.0' }, async () => {
    throw new Error('installer busy');
  });
  const reload = vi.fn();
  const update = new AppUpdate({ webUpdated: () => false, reload });
  const unbind = update.bind();
  await flush();

  await update.apply();

  expect(reload).toHaveBeenCalledOnce();
  unbind();
});

test('the shell reports its update as it downloads and when it is ready', async () => {
  const shell = desktopShell({ status: 'downloading', version: '1.5.0' });
  const states: unknown[] = [];
  const unbind = bindDesktopUpdate((state) => states.push(state));
  await flush();
  shell.push({ status: 'ready', version: '1.5.0' });
  unbind();
  shell.push({ status: 'none' });

  expect(states).toEqual([
    { status: 'downloading', version: '1.5.0' },
    { status: 'ready', version: '1.5.0' }
  ]);
});

test('a browser or an older shell without the bridge has no desktop update', async () => {
  const states: unknown[] = [];
  const unbind = bindDesktopUpdate((state) => states.push(state));
  await flush();
  unbind();

  expect(states).toEqual([]);
  expect(normalizeDesktopUpdate({ status: 'bogus' })).toEqual({ status: 'none', version: '' });
});
