// A viewer sets the stream volume from a slider above the speaker button: the
// popover shows the chosen percent, and the controls stay up while the pointer
// rests on them.

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import ScreenStage from '../../src/lib/features/room/components/ScreenStage.svelte';
import { state } from '../../src/lib/features/room/client/core/state.svelte';
import { bumpScreenUiRevision, screenUi } from '../../src/lib/features/room/screen-ui.svelte';
import { bindScreenStageIdleUi } from '../../src/lib/features/room/client/ui/screen-stage-controls';

const idleAbort = new AbortController();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  state.screenVolume = 1;
  state.screenMuted = false;
  screenUi.stageVisible = false;
});

test('the volume popover shows the percent the viewer picks', async () => {
  render(ScreenStage);
  state.screenVolume = 0.8;
  bumpScreenUiRevision();
  const value = document.querySelector('.stream-volume-value');
  await vi.waitFor(() => expect(value?.textContent?.trim()).toBe('80%'));

  const slider = screen.getByLabelText<HTMLInputElement>('Громкость стрима');
  slider.value = '150';
  await fireEvent.input(slider);

  expect(state.screenVolume).toBe(1.5);
  await vi.waitFor(() => expect(value?.textContent?.trim()).toBe('150%'));
});

test('the controls do not idle out while the pointer rests on them', async () => {
  vi.useFakeTimers();
  render(ScreenStage);
  screenUi.stageVisible = true;
  bindScreenStageIdleUi(idleAbort.signal);
  const stage = document.getElementById('screenStage') as HTMLElement;
  const controls = document.getElementById('screenViewControls') as HTMLElement;

  let pointerOnControls = true;
  vi.spyOn(controls, 'matches').mockImplementation((selector) => selector === ':hover' && pointerOnControls);

  await fireEvent.pointerEnter(stage);
  expect(screenUi.uiActive).toBe(true);
  vi.advanceTimersByTime(3000);
  expect(screenUi.uiActive).toBe(true);

  pointerOnControls = false;
  vi.advanceTimersByTime(1000);
  expect(screenUi.uiActive).toBe(false);
  idleAbort.abort();
});
