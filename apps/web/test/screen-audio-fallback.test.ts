// While a shared screen's video is being republished, its audio keeps playing
// through a separate hidden audio element.

import { afterEach, expect, test, vi } from 'vitest';
import { participant } from './fixtures/participant.ts';
import { instanceOf } from './helpers/assert.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from './helpers/fake-media.ts';

const applied: Array<{ element: HTMLMediaElement; options: { boostAllowed?: boolean } }> = [];
const released: HTMLMediaElement[] = [];
vi.mock('../src/lib/features/room/client/services/media-playback-service', () => ({
  isAppPlaybackMuted: () => false,
  applyScreenMediaElementVolume: (element: HTMLMediaElement, options: { boostAllowed?: boolean }) => {
    applied.push({ element, options });
    return true;
  },
  releaseScreenMediaElement: (element: HTMLMediaElement) => {
    released.push(element);
  }
}));
vi.mock('../src/lib/features/room/screen-ui.svelte', () => ({
  bumpScreenUiRevision: () => {},
  getActiveScreenPeer: () => null,
  getScreenStage: () => null,
  getScreenVideo: () => null,
  getStreamVolumeSlider: () => null,
  screenUi: {}
}));

const { syncScreenAudioFallback } = await import('../src/lib/features/room/client/ui/screen-stage-controls.ts');

afterEach(() => {
  applied.length = 0;
  released.length = 0;
  document.body.replaceChildren();
});

test('screen audio keeps a routed fallback sink during a video republish gap', () => {
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const audioTrack = new FakeMediaStreamTrack('screen-audio', 'audio');
  const peer = participant({ id: 'sharer', screenStream: new FakeMediaStream([audioTrack]) });
  const sinks = () => [...document.body.querySelectorAll('audio')];

  syncScreenAudioFallback(peer, false);
  expect(sinks()).toHaveLength(1);
  expect(instanceOf(sinks()[0]?.srcObject, FakeMediaStream, 'the sink stream').getAudioTracks()[0]).toBe(audioTrack);
  expect(applied.at(-1)?.element).toBe(sinks()[0]);
  expect(applied.at(-1)?.options.boostAllowed).toBe(true);

  syncScreenAudioFallback(peer, false);
  expect(sinks()).toHaveLength(1);

  const first = sinks()[0];
  syncScreenAudioFallback(peer, true);
  expect(released.at(-1)).toBe(first);
  expect(first?.isConnected).toBe(false);

  syncScreenAudioFallback(peer, false);
  expect(sinks()).toHaveLength(1);
  audioTrack.dispatchEvent(new Event('ended'));
  expect(sinks()).toHaveLength(0);
});
