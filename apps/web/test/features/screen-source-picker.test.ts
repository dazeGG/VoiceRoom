// The desktop screen source picker: what a confirmed choice hands to capture.

import { beforeEach, expect, test } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  cancelScreenSourcePicker,
  confirmScreenSourcePicker,
  showScreenSourcePicker,
  switchScreenTab
} from '../../src/lib/features/room/client/ui/screen-source-picker.ts';
import { screenSourceUi } from '../../src/lib/features/room/screen-source-ui.svelte.ts';

const sources = [
  { id: 'screen:1', name: 'Экран 1', type: 'screen' },
  { id: 'window:7', name: 'Игра', type: 'window' }
] as never[];

beforeEach(() => Object.assign(state, createInitialRoomState()));

test('the picker opens on the screens tab with the first screen selected and remembers the last mode', async () => {
  state.localScreenMode = 'text';
  const choice = showScreenSourcePicker(sources);
  expect(screenSourceUi).toMatchObject({ open: true, tab: 'screens', selectedSourceId: 'screen:1', mode: 'text' });

  switchScreenTab('windows');
  expect(screenSourceUi.selectedSourceId).toBe('window:7');
  cancelScreenSourcePicker();
  await expect(choice).rejects.toThrow('Выбор источника отменен');
  expect(screenSourceUi.open).toBe(false);
});

test('smooth mode sends the chosen quality and FPS with audio', async () => {
  const choice = showScreenSourcePicker(sources);
  screenSourceUi.mode = 'games';
  screenSourceUi.quality = 'high';
  screenSourceUi.fps = '60';
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
  screenSourceUi.mode = 'text';
  screenSourceUi.quality = 'high';
  screenSourceUi.fps = '60';
  screenSourceUi.audio = false;
  confirmScreenSourcePicker();
  await expect(choice).resolves.toMatchObject({ mode: 'text', profileId: 'source-5', streamAudioEnabled: false });
  // Choosing does not switch the running share; capture applies it.
  expect(state.localScreenMode).not.toBe('text');
});
