// The "Стрим" plate on a stream tile shows the streamer's own avatar, the same
// picture as their participant tile, and falls back to initials without one.

import { createPinia, setActivePinia } from 'pinia';
import { render } from '@testing-library/vue';
import { beforeEach, expect, test } from 'vitest';
import StreamTile from '@/features/room/components/StreamTile.vue';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { createParticipant } from '@/features/room/client/room/participants';
import type { Participant } from '@/features/room/client/core/types';

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
});

function streamer(extra: Partial<Participant> = {}): Participant {
  const person = createParticipant({ avatarColorKey: 'blue', id: 'peer-a', name: 'Комуто Херовато', screen: true });
  Object.assign(person, extra);
  return person;
}

function plateAvatar(person: Participant): Element {
  const { container } = render(StreamTile, {
    props: { participant: person, hasPreview: false, isCollapsed: false, isSubscribed: false, stream: null }
  });
  const avatar = container.querySelector('.stream-tile__mini-avatar');
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
