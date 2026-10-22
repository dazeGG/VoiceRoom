// Remote video is received only while someone can see the app: hidden to the
// tray, minimized or in a background tab, cameras and screens are disabled on
// the SFU, while voices and screen audio keep flowing.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { onAppVisibilityChange, setDesktopWindowVisible } from '../../src/lib/platform/app-visibility.ts';
import { fakeParticipant, loadLiveKitHarness } from '../helpers/livekit-harness.ts';

class FakePublication {
  enabledCalls: boolean[] = [];
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
  const visibility = await import('../../src/lib/platform/app-visibility.ts');
  // The sources as the harness names them, see TRACK_SOURCE in livekit-harness.ts.
  const publications = {
    camera: new FakePublication('camera', 'TR_cam'),
    microphone: new FakePublication('microphone', 'TR_mic'),
    screen: new FakePublication('screen-video', 'TR_screen'),
    screenAudio: new FakePublication('screen-audio', 'TR_screen_audio'),
    unsubscribed: new FakePublication('screen-video', 'TR_other', false)
  };
  lk.syncParticipant(fakeParticipant('peer-a', Object.values(publications)));

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

test('a listener can be removed and the visibility API does nothing without listeners', () => {
  const listener = vi.fn();
  const stop = onAppVisibilityChange(listener);
  stop();
  setDesktopWindowVisible(false);
  expect(listener).not.toHaveBeenCalled();
});
