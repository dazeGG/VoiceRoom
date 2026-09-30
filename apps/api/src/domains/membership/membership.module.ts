// The membership domain wired together: memberships, joining and leaving
// under the room's admission lock, and the member directory.

import type pg from 'pg';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import { createMemberDirectoryService } from './member-directory.service.ts';
import { createMembershipRepository } from './membership.repository.ts';
import { createMembershipService } from './membership.service.ts';

type PresenceSnapshot = NonNullable<
  NonNullable<Parameters<typeof createMemberDirectoryService>[0]>['getPresenceSnapshot']
>;

export interface MembershipModuleDeps {
  pool: pg.Pool;
  cursorCodec: CursorCodec;
  /** Whether the account (or address) is banned from the room. */
  isBanned: (input: { roomId: string; userId?: string | null; ip?: string | null }) => Promise<boolean>;
  presenceSnapshot: PresenceSnapshot;
}

export function createMembershipModule(deps: MembershipModuleDeps) {
  const repository = createMembershipRepository({ pool: deps.pool });
  const service = createMembershipService({
    pool: deps.pool,
    repository,
    activeBanService: { isBanned: deps.isBanned }
  });
  const directory = createMemberDirectoryService({
    membershipService: service,
    repository,
    cursorCodec: deps.cursorCodec,
    getPresenceSnapshot: deps.presenceSnapshot
  });
  return { directory, repository, service };
}

export type MembershipModule = ReturnType<typeof createMembershipModule>;
