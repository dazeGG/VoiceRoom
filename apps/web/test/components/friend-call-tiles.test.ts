import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import FriendCallTiles from '@/features/friend-call/FriendCallTiles.vue';

test('a friend call renders my tile before the peer tile', () => {
  const avatar = { avatarColorKey: 'blue', avatarAccent: null, avatarUrl: null };
  render(FriendCallTiles, {
    props: {
      self: { id: 'self', displayName: 'Анна', ...avatar },
      peer: { id: 'peer', displayName: 'Борис', ...avatar },
      peerStatus: 'present',
      hasEngine: false
    }
  });

  expect(screen.getAllByRole('heading')).toEqual([
    screen.getByRole('heading', { name: /^Анна/ }),
    screen.getByRole('heading', { name: 'Борис' })
  ]);
});
