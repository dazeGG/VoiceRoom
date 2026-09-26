// The social store: one object over the friendship, friend request, block
// and direct message thread repositories, kept for the callers that take a
// single store.

import type pg from 'pg';
import { createDmThreadRepository } from '../domains/messaging/dm-thread.repository.ts';
import { createFriendRequestRepository } from '../domains/social/friend-request.repository.ts';
import { createFriendshipRepository } from '../domains/social/friendship.repository.ts';
import { createUserBlockRepository } from '../domains/social/user-block.repository.ts';

export { mapMessage, mapPublicUser, orderedPair } from '../domains/social/social-records.ts';
export type { DirectMessage, DirectMessageInvite, PublicUser } from '../domains/social/social-records.ts';

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
