import { expect, test, vi } from 'vitest';
import { isMicrophoneInputSilent } from '../../src/lib/features/room/client/media/input-silence.ts';

function stubAudio({ samples, state = 'running' }: { samples: number[]; state?: AudioContextState }) {
  const closed: boolean[] = [];
  class FakeAudioContext {
    state = state;
    async resume() {}
    async close() {
      closed.push(true);
    }
    createAnalyser() {
      return {
        fftSize: 0,
        getFloatTimeDomainData(target: Float32Array) {
          target.set(samples.slice(0, target.length));
        }
      };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(readonly tracks: unknown[]) {}
    }
  );
  vi.stubGlobal('MediaStreamTrack', class {});
  return closed;
}

/** A microphone track in `readyState`; call it after stubAudio, which registers the stand-in class. */
const track = (readyState: MediaStreamTrackState) => Object.assign(new MediaStreamTrack(), { readyState });

test('exact zeros for the whole sample mean the microphone delivers nothing', async () => {
  const closed = stubAudio({ samples: [0, 0, 0] });
  await expect(isMicrophoneInputSilent(track('live'), 50)).resolves.toBe(true);
  expect(closed).toEqual([true]);
});

test('the faintest room noise means the microphone works', async () => {
  stubAudio({ samples: [0, 0.00001, 0] });
  await expect(isMicrophoneInputSilent(track('live'), 50)).resolves.toBe(false);
});

test('a context the page cannot start yet proves nothing', async () => {
  stubAudio({ samples: [0, 0, 0], state: 'suspended' });
  await expect(isMicrophoneInputSilent(track('live'), 50)).resolves.toBe(false);
});

test('an ended track is not reported', async () => {
  stubAudio({ samples: [0, 0, 0] });
  await expect(isMicrophoneInputSilent(track('ended'), 50)).resolves.toBe(false);
});
