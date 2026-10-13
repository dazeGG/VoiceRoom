// Remote video is received only while someone can see the app: hidden to the
// tray, minimized or in a background tab, cameras and screens are disabled on
// the SFU, while voices and screen audio keep flowing.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import { createParticipant } from '../../src/lib/features/room/client/room/participants.ts';
import { syncRemoteVideoVisibility } from '../../src/lib/features/room/client/services/livekit/remote-participants.ts';
import { isAppVisible, onAppVisibilityChange, setDesktopWindowVisible } from '../../src/lib/platform/app-visibility.ts';

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

let publications: Record<string, FakePublication>;

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  setDocumentVisibility('visible');
  setDesktopWindowVisible(true);
  publications = {
    camera: new FakePublication('camera', 'TR_cam'),
    microphone: new FakePublication('microphone', 'TR_mic'),
    screen: new FakePublication('screen_share', 'TR_screen'),
    screenAudio: new FakePublication('screen_share_audio', 'TR_screen_audio'),
    unsubscribed: new FakePublication('screen_share', 'TR_other', false)
  };
  const peer = createParticipant({ id: 'peer-a', name: 'A' });
  peer.livekitParticipant = {
    trackPublications: new Map(Object.values(publications).map((publication) => [publication.trackSid, publication]))
  } as never;
});

afterEach(() => {
  setDesktopWindowVisible(true);
  setDocumentVisibility('visible');
});

test('hiding the desktop window pauses remote cameras and screens only, showing it resumes them', () => {
  syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([]);

  setDesktopWindowVisible(false);
  expect(isAppVisible()).toBe(false);
  syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([false]);
  expect(publications.screen.enabledCalls).toEqual([false]);
  expect(publications.microphone.enabledCalls).toEqual([]);
  expect(publications.screenAudio.enabledCalls).toEqual([]);
  // setEnabled only works on a subscribed track.
  expect(publications.unsubscribed.enabledCalls).toEqual([]);

  // No repeated requests.
  syncRemoteVideoVisibility();
  expect(publications.camera.enabledCalls).toEqual([false]);

  setDesktopWindowVisible(true);
  syncRemoteVideoVisibility();
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
