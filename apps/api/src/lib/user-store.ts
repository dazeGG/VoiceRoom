// The account store: one object over the account repositories (users,
// sessions, recovery codes, sign-in history), kept for the callers that take
// a single store.

import type pg from 'pg';
import { createLoginEventRepository } from '../domains/account/login-event.repository.ts';
import { createRecoveryCodeRepository } from '../domains/account/recovery-code.repository.ts';
import { createSessionRepository } from '../domains/account/session.repository.ts';
import { createUserRepository } from '../domains/account/user.repository.ts';
import type { UserStoreLogger } from '../domains/account/user-records.ts';

export { publicUser, selfUser, hashSessionToken } from '../domains/account/user-records.ts';
export type { ProfileSource, PublicUser, StoredUser } from '../domains/account/user-records.ts';

function createUserStore({
  logger,
  pool,
  sessionTtlMs
}: {
  logger?: UserStoreLogger;
  pool: pg.Pool;
  sessionTtlMs?: number;
}) {
  return {
    ...createUserRepository({ pool }),
    ...createSessionRepository({ pool, sessionTtlMs, logger }),
    ...createRecoveryCodeRepository({ pool }),
    ...createLoginEventRepository({ pool })
  };
}

export { createUserStore };
export type UserStore = ReturnType<typeof createUserStore>;
