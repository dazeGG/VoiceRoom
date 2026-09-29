// The social store the app composes: one object over the friendship, friend
// request, block and direct message thread repositories for the registry and
// test overrides. Domain code depends on the repository it uses.

import type pg from 'pg';
import { createDmThreadRepository } from '../domains/messaging/dm-thread.repository.ts';
import { createFriendRequestRepository } from '../domains/social/friend-request.repository.ts';
import { createFriendshipRepository } from '../domains/social/friendship.repository.ts';
import { createUserBlockRepository } from '../domains/social/user-block.repository.ts';

function createFriendStore({ pool }: { pool: pg.Pool }) {
  return {
    ...createFriendshipRepository({ pool }),
    ...createFriendRequestRepository({ pool }),
    ...createUserBlockRepository({ pool }),
    ...createDmThreadRepository({ pool })
  };
}

export { createFriendStore };
export type FriendStore = ReturnType<typeof createFriendStore>;
