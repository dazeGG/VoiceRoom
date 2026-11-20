// The desktop screen source picker: what a confirmed choice hands to capture.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test } from 'vitest';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voice-room/call/engine/model/room-state';
import {
  cancelScreenSourcePicker,
  confirmScreenSourcePicker,
  showScreenSourcePicker,
  switchScreenTab
} from '@voice-room/call/engine/ui/screen-source-picker';
import { useScreenSourceUiStore } from '@voice-room/call/engine/core/screen-source-ui.store';
import type { DesktopCaptureSource } from '@voice-room/call/engine/core/types';

const sources: DesktopCaptureSource[] = [
  { id: 'screen:1', name: 'Экран 1', type: 'screen' },
  { id: 'window:7', name: 'Игра', type: 'window' }
];

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
});

test('the picker opens on the screens tab with the first screen selected and remembers the last mode', async () => {
  state.localScreenMode = 'text';
  const choice = showScreenSourcePicker(sources);
  expect(useScreenSourceUiStore()).toMatchObject({
    open: true,
    tab: 'screens',
    selectedSourceId: 'screen:1',
    mode: 'text'
  });

  switchScreenTab('windows');
  expect(useScreenSourceUiStore().selectedSourceId).toBe('window:7');
  cancelScreenSourcePicker();
  await expect(choice).rejects.toThrow('Выбор источника отменен');
  expect(useScreenSourceUiStore().open).toBe(false);
});

test('smooth mode sends the chosen quality and FPS with audio', async () => {
  const choice = showScreenSourcePicker(sources);
  useScreenSourceUiStore().mode = 'games';
  useScreenSourceUiStore().quality = 'high';
  useScreenSourceUiStore().fps = '60';
  confirmScreenSourcePicker();
  await expect(choice).resolves.toMatchObject({
    mode: 'games',
    profileId: 'high-60',
    qualityId: 'high',
    fpsId: '60',
    streamAudioEnabled: true,
    source: { id: 'screen:1' }
  });
});

test('sharp text mode always sends the source resolution at 5 FPS', async () => {
  const choice = showScreenSourcePicker(sources);
  useScreenSourceUiStore().mode = 'text';
  useScreenSourceUiStore().quality = 'high';
  useScreenSourceUiStore().fps = '60';
  useScreenSourceUiStore().audio = false;
  confirmScreenSourcePicker();
  await expect(choice).resolves.toMatchObject({ mode: 'text', profileId: 'source-5', streamAudioEnabled: false });
  // Choosing does not switch the running share; capture applies it.
  expect(state.localScreenMode).not.toBe('text');
});
