// A participant with the camera on shows the picture in place of the avatar;
// our own picture is mirrored like a mirror, and turning it off brings the
// avatar back.

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ParticipantTile from '../../src/lib/features/room/components/ParticipantTile.svelte';
import { reactiveParticipant } from '../../src/lib/features/room/client/core/state.svelte';
import type { Participant } from '../../src/lib/features/room/client/core/types';
import { participant as freshParticipant } from '../fixtures/participant';
import { defined, instanceOf } from '../helpers/assert';

// A class instance, like a real MediaStream: $state does not proxy it.
// Registered as the global MediaStream, so `new MediaStream()` builds one.
class FakeStream {}

beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeStream);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function participant(extra: Partial<Participant> = {}): Participant {
  return reactiveParticipant(freshParticipant({ avatarColorKey: 'blue', id: 'peer-a', name: 'Вася', ...extra }));
}

test('a camera replaces the avatar and goes away when it is turned off', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const stream = new MediaStream();
  const person = participant({ camera: true, cameraStream: stream });
  const { container } = render(ParticipantTile, { participant: person });

  const tile = defined(container.querySelector('.participant'), 'tile');
  const video = instanceOf(container.querySelector('video.participant-camera'), HTMLVideoElement, 'camera video');
  expect(tile.getAttribute('data-camera')).toBe('true');
  expect(video.srcObject).toBe(stream);
  expect(video.muted).toBe(true);
  expect(video.hasAttribute('data-mirrored')).toBe(false);

  person.cameraStream = null;
  person.camera = false;
  await vi.waitFor(() => expect(container.querySelector('video')).toBeNull());
  expect(tile.hasAttribute('data-camera')).toBe(false);
});

test('our own camera is mirrored', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const { container } = render(ParticipantTile, {
    participant: participant({ isLocal: true, camera: true, cameraStream: new MediaStream() })
  });
  expect(container.querySelector('video')?.getAttribute('data-mirrored')).toBe('true');
});

test('a phone turned to its back camera is not mirrored', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte');
  state.cameraFacing = 'environment';
  try {
    const { container } = render(ParticipantTile, {
      participant: participant({ isLocal: true, camera: true, cameraStream: new MediaStream() })
    });
    expect(container.querySelector('video')?.hasAttribute('data-mirrored')).toBe(false);
  } finally {
    state.cameraFacing = 'user';
  }
});

// Safari on iPhone can draw a starting camera small in the middle of its box
// until the box changes size. The picture stays hidden until it has been
// nudged a pixel wider and back, which makes Safari lay it out again.
test('a starting camera is laid out again before it is shown, and again when it changes size', async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const paint = (): void => {
    for (let frame = frames.shift(); frame; frame = frames.shift()) frame(0);
  };
  try {
    const { container } = render(ParticipantTile, {
      participant: participant({ camera: true, cameraStream: new MediaStream() })
    });
    const video = instanceOf(container.querySelector('video'), HTMLVideoElement, 'camera video');
    expect(video.style.opacity).toBe('0');

    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(0);
    expect(video.style.width).toBe('calc(100% + 1px)');
    paint();
    expect(video.style.width).toBe('');
    expect(video.style.opacity).toBe('');

    video.dispatchEvent(new Event('resize'));
    expect(video.style.width).toBe('calc(100% + 1px)');
    paint();
    expect(video.style.width).toBe('');

    // A camera warming up for the first time can settle late: it is nudged again seconds on.
    vi.advanceTimersByTime(3000);
    paint();
    expect(video.style.width).toBe('');
    vi.advanceTimersByTime(6000);
    expect(video.style.width).toBe('calc(100% + 1px)');
    paint();
    expect(video.style.width).toBe('');
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test('a camera that never reports a frame is shown anyway', () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  try {
    const { container } = render(ParticipantTile, {
      participant: participant({ camera: true, cameraStream: new MediaStream() })
    });
    const video = instanceOf(container.querySelector('video'), HTMLVideoElement, 'camera video');
    expect(video.style.opacity).toBe('0');
    vi.advanceTimersByTime(1500);
    expect(video.style.opacity).toBe('');
  } finally {
    vi.useRealTimers();
  }
});
