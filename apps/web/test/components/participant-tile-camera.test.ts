// A participant with the camera on shows the picture in place of the avatar;
// our own picture is mirrored like a mirror, and turning it off brings the
// avatar back.

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import ParticipantTile from '../../src/lib/features/room/components/ParticipantTile.svelte';
import { reactiveParticipant } from '../../src/lib/features/room/client/core/state.svelte';
import type { Participant } from '../../src/lib/features/room/client/core/types';

// A class instance, like a real MediaStream: $state does not proxy it.
class FakeStream {}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function participant(extra: Partial<Participant> = {}): Participant {
  return reactiveParticipant({
    accountUserId: '',
    avatarAccent: '',
    avatarColorKey: 'blue',
    avatarUrl: '',
    camera: false,
    cameraStream: null,
    deafened: false,
    id: 'peer-a',
    isLocal: false,
    level: 0,
    muted: false,
    name: 'Вася',
    screen: false,
    speaking: false,
    statusLabel: '',
    ...extra
  } as Participant);
}

test('a camera replaces the avatar and goes away when it is turned off', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const stream = new FakeStream() as MediaStream;
  const person = participant({ camera: true, cameraStream: stream });
  const { container } = render(ParticipantTile, { participant: person });

  const tile = container.querySelector('.participant')!;
  const video = container.querySelector<HTMLVideoElement>('video.participant-camera')!;
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
    participant: participant({ isLocal: true, camera: true, cameraStream: new FakeStream() as MediaStream })
  });
  expect(container.querySelector('video')?.getAttribute('data-mirrored')).toBe('true');
});
