// Remote video is received only while someone can see the app: hidden to the
// tray, minimized or in a background tab, cameras and screens are disabled on
// the SFU, while voices and screen audio keep flowing.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { onAppVisibilityChange, setDesktopWindowVisible } from '@/platform/app-visibility.ts';
import { defined } from '../helpers/assert.ts';
import { fakeParticipant, flushMicrotasks, loadLiveKitHarness } from '../helpers/livekit-harness.ts';

class FakePublication {
  enabledCalls: boolean[] = [];
  qualityCalls: number[] = [];
  requestedDisabled: boolean | undefined;
  constructor(
    readonly source: string,
    readonly trackSid: string,
    public isDesired = true
  ) {}
  get isEnabled() {
    return this.requestedDisabled === undefined ? true : !this.requestedDisabled;
  }
  setEnabled(enabled: boolean) {
    this.enabledCalls.push(enabled);
    this.requestedDisabled = !enabled;
  }
  setSubscribed(subscribed: boolean) {
    this.isDesired = subscribed;
  }
  setVideoQuality(quality: number) {
    this.qualityCalls.push(quality);
  }
}

function setDocumentVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  setDocumentVisibility('visible');
  setDesktopWindowVisible(true);
});

afterEach(() => {
  setDesktopWindowVisible(true);
  setDocumentVisibility('visible');
});

test('hiding the desktop window pauses remote cameras and screens only, showing it resumes them', async () => {
  const lk = await loadLiveKitHarness();
  // The service was loaded fresh: it reads the visibility of its own module instance.
  const visibility = await import('@/platform/app-visibility.ts');
  // The sources as the harness names them, see TRACK_SOURCE in livekit-harness.ts.
  const publications = {
    camera: new FakePublication('camera', 'TR_cam'),
    microphone: new FakePublication('microphone', 'TR_mic'),
    screen: new FakePublication('screen-video', 'TR_screen'),
    screenAudio: new FakePublication('screen-audio', 'TR_screen_audio'),
    unsubscribed: new FakePublication('screen-video', 'TR_other', false)
  };
  lk.state.viewedScreenPeerId = 'peer-a';
  const { unsubscribed, ...demanded } = publications;
  lk.syncParticipant(fakeParticipant('peer-a', Object.values(demanded)));
  lk.syncParticipant(fakeParticipant('peer-b', [unsubscribed]));

  lk.service.syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([]);

  visibility.setDesktopWindowVisible(false);
  expect(visibility.isAppVisible()).toBe(false);
  lk.service.syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([false]);
  expect(publications.screen.enabledCalls).toEqual([false]);
  expect(publications.microphone.enabledCalls).toEqual([]);
  expect(publications.screenAudio.enabledCalls).toEqual([]);
  // setEnabled only works on a subscribed track.
  expect(publications.unsubscribed.enabledCalls).toEqual([]);

  // No repeated requests.
  lk.service.syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([false]);

  visibility.setDesktopWindowVisible(true);
  lk.service.syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([false, true]);
  expect(publications.screen.enabledCalls).toEqual([false, true]);
});

test('a background browser tab counts as not visible, and listeners hear each change once', () => {
  const changes: boolean[] = [];
  const stop = onAppVisibilityChange((visible) => changes.push(visible));
  setDocumentVisibility('hidden');
  setDocumentVisibility('hidden');
  setDesktopWindowVisible(false);
  setDocumentVisibility('visible');
  setDesktopWindowVisible(true);
  stop();
  setDocumentVisibility('hidden');
  expect(changes).toEqual([false, true]);
});

test('game coverage reported by the shell pauses video and resumes it when the window is uncovered', async () => {
  const lk = await loadLiveKitHarness();
  const { bindDesktopSystem } = await import('@/platform/desktop-system.ts');
  const { onAppVisibilityChange } = await import('@/platform/app-visibility.ts');
  let pushState: (payload: unknown) => void = () => {};
  vi.stubGlobal('voiceRoomDesktopSystem', {
    onState(handler: typeof pushState) {
      pushState = handler;
    }
  });
  const unbind = bindDesktopSystem({ onWake: () => {} });
  const unsubscribe = onAppVisibilityChange(lk.service.syncRemoteVideoVisibility);
  const camera = new FakePublication('camera', 'TR_cam');
  const screen = new FakePublication('screen-video', 'TR_screen');
  const microphone = new FakePublication('microphone', 'TR_mic');
  const screenAudio = new FakePublication('screen-audio', 'TR_screen_audio');
  lk.state.viewedScreenPeerId = 'peer-a';
  lk.syncParticipant(fakeParticipant('peer-a', [camera, screen, microphone, screenAudio]));
  try {
    pushState({ windowVisible: true, windowCovered: true });
    expect(camera.enabledCalls).toEqual([false]);
    expect(screen.enabledCalls).toEqual([false]);
    expect(microphone.enabledCalls).toEqual([]);
    expect(screenAudio.enabledCalls).toEqual([]);
    pushState({ windowVisible: true, windowCovered: false });
    expect(camera.enabledCalls).toEqual([false, true]);
    expect(screen.enabledCalls).toEqual([false, true]);
  } finally {
    unsubscribe();
    unbind();
    vi.unstubAllGlobals();
  }
});

test('a listener can be removed and the visibility API does nothing without listeners', () => {
  const listener = vi.fn();
  const stop = onAppVisibilityChange(listener);
  stop();
  setDesktopWindowVisible(false);
  expect(listener).not.toHaveBeenCalled();
});

test('switching the watched screen while covered restores its stage quality and the focused camera', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  const { setDesktopWindowVisible } = await import('@/platform/app-visibility');
  const { useParticipantsUiStore } = await import('@voiceroom/call/engine/core/participants-ui.store');
  useParticipantsUiStore().focusedParticipantId = 'peer-a';
  const camera = new FakePublication('camera', 'TR_cam');
  const microphone = new FakePublication('microphone', 'TR_mic');
  const firstScreen = new FakePublication('screen-video', 'TR_first', false);
  const secondScreen = new FakePublication('screen-video', 'TR_second', false);
  const screenAudio = new FakePublication('screen-audio', 'TR_audio', false);
  lk.state.viewedScreenPeerId = 'peer-a';
  const first = defined(lk.syncParticipant(fakeParticipant('peer-a', [camera, microphone, firstScreen])), 'peer-a');
  const second = defined(lk.syncParticipant(fakeParticipant('peer-b', [secondScreen, screenAudio])), 'peer-b');
  await flushMicrotasks();
  expect(firstScreen.isDesired).toBe(true);
  try {
    setDesktopWindowVisible(true, true);
    lk.service.syncRemoteVideoVisibility();
    lk.state.viewedScreenPeerId = 'peer-b';
    lk.service.syncLiveKitScreenSubscriptions(first);
    lk.service.syncLiveKitScreenSubscriptions(second);
    await flushMicrotasks();
    expect(secondScreen.isEnabled).toBe(false);
    expect(firstScreen.isDesired).toBe(false);
    expect(secondScreen.isDesired).toBe(true);
    expect(screenAudio.isDesired).toBe(true);
    setDesktopWindowVisible(true);
    lk.service.syncRemoteVideoVisibility();
    expect(camera.enabledCalls).toEqual([false, true]);
    expect(secondScreen.enabledCalls).toEqual([false, true]);
    expect(firstScreen.enabledCalls).toEqual([false]);
    expect(camera.qualityCalls.at(-1)).toBe(2);
    expect(secondScreen.qualityCalls.at(-1)).toBe(2);
    expect(microphone.isEnabled).toBe(true);
    expect(screenAudio.isEnabled).toBe(true);
    expect(microphone.enabledCalls).toEqual([]);
    expect(screenAudio.enabledCalls).toEqual([]);
  } finally {
    setDesktopWindowVisible(true);
  }
});
