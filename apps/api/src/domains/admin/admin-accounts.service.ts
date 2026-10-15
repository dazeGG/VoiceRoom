// The admin panel's accounts: the list and one account's card, and what the
// platform administrator may do to an account — block it for a while or for
// good, sign it out everywhere, delete it (blocked at once, gone after the
// grace period, called off within it), and give or take its mark. Nobody acts
// on an administrator's account this way, their own included; every action
// lands in the log with the reason.

import {
  ACCOUNTS_PAGE_SIZE,
  type AccountDetail,
  type AccountRow,
  type AccountsPage,
  type AccountsQuery,
  type AdminActionKind,
  type BlockDuration
} from '@voice-room/shared/contracts/admin';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import type { AccountStandingRepository } from '../account/account-standing.repository.ts';
import type { AccountDeletionRepository } from '../account/account-deletion.repository.ts';
import type { AdminAccountsRepository, StoredAccountRow } from './admin-accounts.repository.ts';
import type { AdminActionInput, AdminActionRepository } from './admin-action.repository.ts';
import { isPlatformAdmin } from './admin.policy.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const BLOCK_SPANS: Record<BlockDuration, number | null> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  forever: null
};

type Payload<T> = Omit<T, 'ok'>;
export type AccountAction =
  | { status: 'done'; detail: Payload<AccountDetail> }
  | {
      status:
        | 'forbidden'
        | 'not_found'
        | 'invalid_reason'
        | 'cannot_moderate_admin'
        | 'confirmation_mismatch'
        | 'deletion_not_by_admin'
        | 'unavailable';
    };

export interface AdminAccountsDeps {
  adminUserIds: readonly string[];
  accounts(): Pick<AdminAccountsRepository, 'list' | 'detail'>;
  standing(): Pick<AccountStandingRepository, 'block' | 'unblock' | 'endAllSessions' | 'setBadge' | 'listBadges'>;
  deletions(): Pick<AccountDeletionRepository, 'requestDeletionByOperator' | 'cancelOperatorDeletion'> | null;
  actions(): Pick<AdminActionRepository, 'record' | 'listFor'>;
  /** Accounts with a socket open right now. */
  onlineUserIds(): string[];
  /** Closes what the account still holds open: sockets and voice seats. */
  endSessionConnections(input: { userId: string }): Promise<void>;
  /** Shows the account's new public profile to its friends and live rooms. */
  profileChanged(userId: string): Promise<void>;
  logger(): Pick<Logger, 'error'>;
  now?: () => number;
}

export function createAdminAccountsService(deps: AdminAccountsDeps) {
  const now = deps.now ?? Date.now;
  const admin = (userId: string | null | undefined) => isPlatformAdmin(deps.adminUserIds, userId);

  function row(account: StoredAccountRow, online: Set<string>): AccountRow {
    const { blocked, deletion, ...rest } = account;
    return {
      ...rest,
      online: online.has(account.id),
      admin: admin(account.id),
      status: deletion ? 'deleting' : blocked ? 'blocked' : 'active'
    };
  }

  async function list(adminId: string, query: AccountsQuery = {}): Promise<Payload<AccountsPage> | null> {
    if (!admin(adminId)) return null;
    const onlineIds = deps.onlineUserIds();
    const page = Number(query.page) || 1;
    const result = await deps.accounts().list({
      q: (query.q ?? '').trim(),
      filter: query.filter ?? 'all',
      sort: query.sort ?? 'created',
      order: query.order ?? 'desc',
      page,
      onlineIds
    });
    const online = new Set(onlineIds);
    return {
      accounts: result.accounts.map((account) => row(account, online)),
      total: result.total,
      page,
      pageSize: ACCOUNTS_PAGE_SIZE
    };
  }

  async function load(userId: string): Promise<Payload<AccountDetail> | null> {
    const [found, actions] = await Promise.all([deps.accounts().detail(userId, now()), deps.actions().listFor(userId)]);
    if (!found) return null;
    const { account, ...rest } = found;
    return {
      ...rest,
      account: row(account, new Set(deps.onlineUserIds())),
      block: account.blocked,
      deletion: account.deletion,
      actions
    };
  }

  async function detail(adminId: string, userId: string): Promise<AccountAction> {
    if (!admin(adminId)) return { status: 'forbidden' };
    const found = await load(userId);
    return found ? { status: 'done', detail: found } : { status: 'not_found' };
  }

  // A failed log entry must not undo an action already taken; it is logged instead.
  async function record(input: AdminActionInput): Promise<void> {
    try {
      await deps.actions().record(input, now());
    } catch (error) {
      deps.logger().error(
        {
          evt: LOG_EVENTS.ADMIN_ACTION_LOG_FAILED,
          action: input.action,
          targetUserId: input.targetUserId,
          err: error
        },
        'failed to log an administrator action'
      );
    }
  }

  // The checks every action shares: an administrator acts, never on an
  // administrator's account, and gives a reason where one is asked for.
  async function act(
    adminId: string,
    userId: string,
    action: AdminActionKind,
    run: () => Promise<AccountAction | AdminActionInput | null>
  ): Promise<AccountAction> {
    if (!admin(adminId)) return { status: 'forbidden' };
    if (action !== 'badge' && admin(userId)) return { status: 'cannot_moderate_admin' };
    const outcome = await run();
    if (!outcome) return { status: 'not_found' };
    if ('status' in outcome) return outcome;
    await record(outcome);
    const found = await load(userId);
    return found ? { status: 'done', detail: found } : { status: 'not_found' };
  }

  function cleanReason(reason: string): string {
    return reason.replace(/\s+/g, ' ').trim();
  }

  async function block(
    adminId: string,
    userId: string,
    input: { duration: BlockDuration; reason: string }
  ): Promise<AccountAction> {
    return act(adminId, userId, 'block', async () => {
      const reason = cleanReason(input.reason);
      if (!reason) return { status: 'invalid_reason' };
      const span = BLOCK_SPANS[input.duration];
      const until = span === null ? null : now() + span;
      if (!(await deps.standing().block({ userId, until, reason, now: now() }))) return null;
      await deps.endSessionConnections({ userId });
      return { adminUserId: adminId, targetUserId: userId, action: 'block', reason, until };
    });
  }

  async function unblock(adminId: string, userId: string): Promise<AccountAction> {
    return act(adminId, userId, 'unblock', async () => {
      if (!(await deps.standing().unblock({ userId, now: now() }))) return null;
      return { adminUserId: adminId, targetUserId: userId, action: 'unblock' };
    });
  }

  async function signOutEverywhere(adminId: string, userId: string): Promise<AccountAction> {
    return act(adminId, userId, 'logout', async () => {
      const found = await deps.accounts().detail(userId, now());
      if (!found) return null;
      await deps.standing().endAllSessions(userId);
      await deps.endSessionConnections({ userId });
      return { adminUserId: adminId, targetUserId: userId, action: 'logout' };
    });
  }

  async function remove(
    adminId: string,
    userId: string,
    input: { login: string; reason: string }
  ): Promise<AccountAction> {
    return act(adminId, userId, 'delete', async () => {
      const repository = deps.deletions();
      if (!repository) return { status: 'unavailable' };
      const reason = cleanReason(input.reason);
      if (!reason) return { status: 'invalid_reason' };
      const found = await deps.accounts().detail(userId, now());
      if (!found) return null;
      if (input.login.trim().toLowerCase() !== found.account.login) return { status: 'confirmation_mismatch' };
      const result = await repository.requestDeletionByOperator({ userId, adminUserId: adminId, reason, now: now() });
      if (result.status === 'not_found') return null;
      // Already leaving at the owner's request: the deletion keeps its date,
      // but a block for good takes the restore away.
      if (result.status === 'already_requested')
        await deps.standing().block({ userId, until: null, reason, now: now() });
      await deps.endSessionConnections({ userId });
      if (result.status === 'requested') await deps.profileChanged(userId);
      return { adminUserId: adminId, targetUserId: userId, action: 'delete', reason };
    });
  }

  async function cancelDeletion(adminId: string, userId: string): Promise<AccountAction> {
    return act(adminId, userId, 'cancel_deletion', async () => {
      const repository = deps.deletions();
      if (!repository) return { status: 'unavailable' };
      const result = await repository.cancelOperatorDeletion({ userId, now: now() });
      if (result.status === 'not_found') return null;
      if (result.status === 'not_by_admin') return { status: 'deletion_not_by_admin' };
      await deps.profileChanged(userId);
      return { adminUserId: adminId, targetUserId: userId, action: 'cancel_deletion' };
    });
  }

  async function setBadge(adminId: string, userId: string, badge: AccountBadge | null): Promise<AccountAction> {
    return act(adminId, userId, 'badge', async () => {
      if (!(await deps.standing().setBadge({ userId, badge, now: now() }))) return null;
      return { adminUserId: adminId, targetUserId: userId, action: 'badge', badge };
    });
  }

  async function badges(): Promise<{ userId: string; badge: AccountBadge }[]> {
    return deps.standing().listBadges();
  }

  return Object.freeze({ list, detail, block, unblock, signOutEverywhere, remove, cancelDeletion, setBadge, badges });
}

export type AdminAccountsService = ReturnType<typeof createAdminAccountsService>;
