// The sound plays on the system device while the saved speaker is gone, so the
// settings say so, and choosing the system entry makes the move final.

import { screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { restoreOutputDevice, setOutputDevice } from '@/features/room/client';
import SoundSettings from '@/features/home/components/settings/SoundSettings.vue';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render';

vi.mock('@/features/room/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  restoreOutputDevice: vi.fn(async () => true),
  setOutputDevice: vi.fn(async () => true)
}));

function speaker(deviceId: string) {
  return { kind: 'audiooutput', deviceId, groupId: deviceId, label: deviceId };
}

function stubDevices(devices: ReturnType<typeof speaker>[]) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => devices.map((device) => Object.assign(new MediaDeviceInfo(), device)) }
  });
}

async function renderSettings() {
  await renderWithApp(SoundSettings, { props: { desktopApp: false } });
  return screen.getByRole('combobox', { name: 'Динамик' });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(setOutputDevice).mockClear();
  vi.mocked(restoreOutputDevice).mockClear();
  stubOverlayDom();
  vi.stubGlobal('MediaDeviceInfo', class {});
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.unstubAllGlobals();
});

test('a saved speaker the system no longer has shows as unavailable, and the system one brings the sound back', async () => {
  localStorage.setItem('voice-room:output-device-id', 'gone');
  stubDevices([speaker('speakers')]);

  const trigger = await renderSettings();
  await waitFor(() => expect(trigger.textContent).toContain('Устройство недоступно'));

  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: 'Системный' }));

  await waitFor(() => expect(setOutputDevice).toHaveBeenCalledWith(''));
  expect(localStorage.getItem('voice-room:output-device-id')).toBeNull();
  expect(trigger.textContent).toContain('Системный');

  await user.click(trigger);
  expect((await screen.findAllByRole('option')).map((option) => option.textContent?.trim())).toEqual([
    'Системный',
    'speakers'
  ]);
});

test('a failed pick goes back to the saved speaker without leaving the sound off', async () => {
  localStorage.setItem('voice-room:output-device-id', 'gone');
  stubDevices([speaker('speakers')]);
  vi.mocked(setOutputDevice).mockResolvedValueOnce(false);

  const trigger = await renderSettings();
  await waitFor(() => expect(trigger.textContent).toContain('Устройство недоступно'));

  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: 'speakers' }));

  await waitFor(() => expect(restoreOutputDevice).toHaveBeenCalledWith('gone'));
  expect(localStorage.getItem('voice-room:output-device-id')).toBe('gone');
});

test('a saved speaker that is still there shows by its name', async () => {
  localStorage.setItem('voice-room:output-device-id', 'speakers');
  stubDevices([speaker('speakers')]);

  const trigger = await renderSettings();

  await waitFor(() => expect(trigger.textContent).toContain('speakers'));
  expect(trigger.textContent).not.toContain('Устройство недоступно');
});
