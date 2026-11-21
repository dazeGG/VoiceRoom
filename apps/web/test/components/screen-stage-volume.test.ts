// A viewer sets the stream volume from a slider above the speaker button: the
// popover shows the chosen percent, and the controls stay up while the pointer
// rests on them.

import { createPinia, setActivePinia } from 'pinia';
import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ScreenStage from '@/features/room/components/ScreenStage.vue';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voice-room/call/engine/model/room-state';
import { bindScreenStageIdleUi } from '@voice-room/call/engine/ui/screen-stage-controls';
import { useScreenUiStore } from '@voice-room/call/engine/core/screen-ui.store';
import { MAX_STREAM_VOLUME } from '@voice-room/call/engine/core/config';
import { isTypingTarget } from '@voice-room/call/engine/core/hotkeys';
import { createParticipant } from '@voice-room/call/engine/room/participants';
import { applyScreenMediaElementVolume } from '@voice-room/call/engine/services/media-playback-service';
import { instanceOf } from '../helpers/assert.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';
import { stubOverlayDom } from '../helpers/overlay-dom';

vi.mock(import('@voice-room/call/engine/services/media-playback-service'), async (importOriginal) => ({
  ...(await importOriginal()),
  applyScreenMediaElementVolume: vi.fn()
}));
vi.mock(import('@voice-room/call/engine/media/cues'), async (importOriginal) => ({
  ...(await importOriginal()),
  playStreamCue: vi.fn()
}));

const idleAbort = new AbortController();

beforeEach(() => {
  stubOverlayDom();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  vi.mocked(applyScreenMediaElementVolume).mockClear();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('dragging the volume slider changes remote playback and muting keeps the chosen level', async () => {
  const owner = createParticipant({ id: 'owner', name: 'Анна', screen: true });
  state.viewedScreenPeerId = owner.id;
  state.screenVolume = 0.8;
  const screenUi = useScreenUiStore();
  screenUi.stageVisible = true;
  screenUi.activeStream = new FakeMediaStream([
    new FakeMediaStreamTrack('screen-video', 'video'),
    new FakeMediaStreamTrack('screen-audio', 'audio')
  ]);
  const { container } = render(ScreenStage);
  const video = instanceOf(container.querySelector('video'), HTMLVideoElement, 'screen video');
  const user = userEvent.setup();
  const speaker = screen.getByRole('button', { name: 'Выключить звук стрима' });
  await user.hover(speaker);
  const slider = await screen.findByRole('slider', { name: 'Громкость стрима' });
  const track = instanceOf(slider.closest('.stream-volume__slider'), HTMLElement, 'slider track');
  track.getBoundingClientRect = () => new DOMRect(0, 0, 32, 100);
  slider.getBoundingClientRect = () => new DOMRect(0, 50, 32, 16);
  Object.defineProperty(slider, 'clientHeight', { value: 16 });
  Object.defineProperty(slider, 'hasPointerCapture', { value: () => true });

  expect(slider.getAttribute('aria-orientation')).toBe('vertical');
  expect(isTypingTarget(slider)).toBe(true);
  expect(slider.getAttribute('aria-valuemax')).toBe(String(MAX_STREAM_VOLUME * 100));
  expect(slider.getAttribute('aria-valuetext')).toBe('80%');
  await user.pointer([
    { keys: '[MouseLeft>]', target: slider, coords: { clientX: 16, clientY: 58 } },
    { target: slider, coords: { clientX: 16, clientY: 59 } },
    { target: slider, coords: { clientX: 16, clientY: 30 } },
    '[/MouseLeft]'
  ]);

  expect(state.screenVolume).toBe(1.5);
  expect(slider.getAttribute('aria-valuetext')).toBe('150%');
  expect(screen.getByText('150%')).toBeTruthy();
  expect(applyScreenMediaElementVolume).toHaveBeenLastCalledWith(video, {
    boostAllowed: true,
    muted: false,
    volume: 1.5
  });

  await user.click(speaker);
  expect(screen.getByRole('button', { name: 'Включить звук стрима', pressed: true })).toBe(speaker);
  expect(applyScreenMediaElementVolume).toHaveBeenLastCalledWith(video, {
    boostAllowed: true,
    muted: true,
    volume: 1.5
  });

  await user.click(speaker);
  expect(screen.getByRole('button', { name: 'Выключить звук стрима', pressed: false })).toBe(speaker);
  expect(slider.getAttribute('aria-valuetext')).toBe('150%');
  expect(applyScreenMediaElementVolume).toHaveBeenLastCalledWith(video, {
    boostAllowed: true,
    muted: false,
    volume: 1.5
  });
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
