// A viewer sets the stream volume from a slider above the speaker button: the
// popover shows the chosen percent, and the controls stay up while the pointer
// rests on them.

import { createPinia, setActivePinia } from 'pinia';
import { fireEvent, render, screen } from '@testing-library/vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ScreenStage from '@/features/room/components/ScreenStage.vue';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { bindScreenStageIdleUi } from '@/features/room/client/ui/screen-stage-controls';
import { useScreenUiStore } from '@/features/room/screen-ui.store';
import { instanceOf } from '../helpers/assert.ts';

const idleAbort = new AbortController();

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('the volume popover shows the percent the viewer picks', async () => {
  render(ScreenStage);
  state.screenVolume = 0.8;
  useScreenUiStore().bumpScreenUiRevision();
  const value = document.querySelector('.stream-volume__value');
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
  const screenUi = useScreenUiStore();
  screenUi.stageVisible = true;
  await vi.advanceTimersByTimeAsync(0);
  bindScreenStageIdleUi(idleAbort.signal);
  const stage = instanceOf(document.getElementById('screenStage'), HTMLElement, 'screen stage');
  const controls = instanceOf(document.getElementById('screenViewControls'), HTMLElement, 'stage controls');

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
