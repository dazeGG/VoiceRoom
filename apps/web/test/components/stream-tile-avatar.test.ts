// The "Стрим" plate on a stream tile shows the streamer's own avatar, the same
// picture as their participant tile, and falls back to initials without one.

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import StreamTile from '../../src/lib/features/room/components/StreamTile.svelte';
import { reactiveParticipant } from '../../src/lib/features/room/client/core/state.svelte';
import type { Participant } from '../../src/lib/features/room/client/core/types';

afterEach(cleanup);

function streamer(extra: Partial<Participant> = {}): Participant {
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
    muted: false,
    name: 'Комуто Херовато',
    screen: true,
    speaking: false,
    statusLabel: '',
    ...extra
  } as Participant);
}

function renderTile(participant: Participant) {
  return render(StreamTile, { participant, hasPreview: false, isCollapsed: false, isSubscribed: false, stream: null });
}

test('the stream plate shows the uploaded avatar of the streamer', () => {
  const { container } = renderTile(streamer({ avatarUrl: '/avatars/komuto.webp' }));
  const avatar = container.querySelector('.stream-tile-mini-avatar')!;
  expect(avatar.querySelector('img')?.getAttribute('src')).toBe('/avatars/komuto.webp');
});

test('without an avatar the stream plate shows initials', () => {
  const { container } = renderTile(streamer());
  const avatar = container.querySelector('.stream-tile-mini-avatar')!;
  expect(avatar.querySelector('img')).toBeNull();
  expect(avatar.textContent?.trim()).not.toBe('');
});
