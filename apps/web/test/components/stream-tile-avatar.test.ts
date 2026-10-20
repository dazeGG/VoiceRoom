// The "Стрим" plate on a stream tile shows the streamer's own avatar, the same
// picture as their participant tile, and falls back to initials without one.

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import StreamTile from '../../src/lib/features/room/components/StreamTile.svelte';
import { reactiveParticipant } from '../../src/lib/features/room/client/core/state.svelte';
import type { Participant } from '../../src/lib/features/room/client/core/types';
import { participant } from '../fixtures/participant';

afterEach(cleanup);

function streamer(extra: Partial<Participant> = {}): Participant {
  return reactiveParticipant(
    participant({ avatarColorKey: 'blue', id: 'peer-a', name: 'Комуто Херовато', screen: true, ...extra })
  );
}

function plateAvatar(person: Participant): Element {
  const { container } = render(StreamTile, {
    participant: person,
    hasPreview: false,
    isCollapsed: false,
    isSubscribed: false,
    stream: null
  });
  const avatar = container.querySelector('.stream-tile-mini-avatar');
  if (!avatar) throw new Error('the stream plate has no avatar');
  return avatar;
}

test('the stream plate shows the uploaded avatar of the streamer', () => {
  const avatar = plateAvatar(streamer({ avatarUrl: '/avatars/komuto.webp' }));
  expect(avatar.querySelector('img')?.getAttribute('src')).toBe('/avatars/komuto.webp');
});

test('without an avatar the stream plate shows initials', () => {
  const avatar = plateAvatar(streamer());
  expect(avatar.querySelector('img')).toBeNull();
  expect((avatar.textContent ?? '').trim()).not.toBe('');
});
