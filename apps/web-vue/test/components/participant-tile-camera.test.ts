// A participant with the camera on shows the picture in place of the avatar;
// our own picture is mirrored like a mirror, and turning it off brings the
// avatar back.

import { createPinia, setActivePinia } from 'pinia';
import { render } from '@testing-library/vue';
import { nextTick } from 'vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ParticipantTile from '@/features/room/components/ParticipantTile.vue';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { createParticipant } from '@/features/room/client/room/participants';
import type { Participant } from '@/features/room/client/core/types';
import { defined, instanceOf } from '../helpers/assert';

// A class instance, like a real MediaStream: Vue does not proxy it.
// Registered as the global MediaStream, so `new MediaStream()` builds one.
class FakeStream {
  get [Symbol.toStringTag](): string {
    return 'MediaStream';
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  vi.stubGlobal('MediaStream', FakeStream);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function participant(extra: Partial<Participant> = {}): Participant {
  const person = createParticipant({
    avatarColorKey: 'blue',
    id: 'peer-a',
    name: 'Вася',
    ...(extra.isLocal === undefined ? {} : { isLocal: extra.isLocal })
  });
  Object.assign(person, extra);
  return person;
}

function renderTile(person: Participant) {
  return render(ParticipantTile, { props: { participant: person } });
}

test('a camera replaces the avatar and goes away when it is turned off', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const stream = new MediaStream();
  const person = participant({ camera: true, cameraStream: stream });
  const { container } = renderTile(person);

  const tile = defined(container.querySelector('.participant'), 'tile');
  await vi.waitFor(() => expect(container.querySelector('video.participant__camera')).not.toBeNull());
  const video = instanceOf(container.querySelector('video.participant__camera'), HTMLVideoElement, 'camera video');
  expect(tile.classList.contains('participant--camera')).toBe(true);
  expect(video.srcObject).toBe(stream);
  expect(video.muted).toBe(true);
  expect(video.classList.contains('participant__camera--mirrored')).toBe(false);

  person.cameraStream = null;
  person.camera = false;
  await vi.waitFor(() => expect(container.querySelector('video')).toBeNull());
  expect(tile.classList.contains('participant--camera')).toBe(false);
});

test('our own camera is mirrored', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  state.peerId = 'peer-a';
  const { container } = renderTile(participant({ isLocal: true, camera: true, cameraStream: new MediaStream() }));
  expect(container.querySelector('video')?.classList.contains('participant__camera--mirrored')).toBe(true);
});

test('a phone turned to its back camera is not mirrored', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  state.peerId = 'peer-a';
  state.cameraFacing = 'environment';
  const { container } = renderTile(participant({ isLocal: true, camera: true, cameraStream: new MediaStream() }));
  expect(container.querySelector('video')?.classList.contains('participant__camera--mirrored')).toBe(false);
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
    const { container } = renderTile(participant({ camera: true, cameraStream: new MediaStream() }));
    await nextTick();
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

test('a camera that never reports a frame is shown anyway', async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  try {
    const { container } = renderTile(participant({ camera: true, cameraStream: new MediaStream() }));
    await nextTick();
    const video = instanceOf(container.querySelector('video'), HTMLVideoElement, 'camera video');
    expect(video.style.opacity).toBe('0');
    vi.advanceTimersByTime(1500);
    expect(video.style.opacity).toBe('');
  } finally {
    vi.useRealTimers();
  }
});
