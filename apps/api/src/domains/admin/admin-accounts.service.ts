// The admin panel's accounts: the list and one account's card, and what staff
// may do to an account — block it for a while or for good, sign it out
// everywhere, delete it (blocked at once, gone after the grace period, called
// off within it), and give or take its mark. A moderator blocks for a while and
// signs out; a block for good, deletion and marks take an administrator. Nobody
// acts on a staff member's account this way, their own included; every action
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
import type { StaffPermission } from '@voice-room/shared/contracts/staff';

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
  staff: {
    can(userId: string, permission: StaffPermission): Promise<boolean>;
    /** Every staff account right now. */
    memberIds(): Promise<string[]>;
  };
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

  function row(account: StoredAccountRow, online: Set<string>, staffIds: Set<string>): AccountRow {
    const { blocked, deletion, ...rest } = account;
    return {
      ...rest,
      online: online.has(account.id),
      admin: staffIds.has(account.id),
      status: deletion ? 'deleting' : blocked ? 'blocked' : 'active'
    };
  }

  async function list(adminId: string, query: AccountsQuery = {}): Promise<Payload<AccountsPage> | null> {
    if (!(await deps.staff.can(adminId, 'accounts.view'))) return null;
    const onlineIds = deps.onlineUserIds();
    const staffIds = new Set(await deps.staff.memberIds());
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
      accounts: result.accounts.map((account) => row(account, online, staffIds)),
      total: result.total,
      page,
      pageSize: ACCOUNTS_PAGE_SIZE
    };
  }

  async function load(userId: string): Promise<Payload<AccountDetail> | null> {
    const [found, actions, staffIds] = await Promise.all([
      deps.accounts().detail(userId, now()),
      deps.actions().listFor(userId),
      deps.staff.memberIds()
    ]);
    if (!found) return null;
    const { account, ...rest } = found;
    return {
      ...rest,
      account: row(account, new Set(deps.onlineUserIds()), new Set(staffIds)),
      block: account.blocked,
      deletion: account.deletion,
      actions
    };
  }

  async function detail(adminId: string, userId: string): Promise<AccountAction> {
    if (!(await deps.staff.can(adminId, 'accounts.view'))) return { status: 'forbidden' };
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

  // The checks every action shares: staff with the permission acts, never on a
  // staff member's account, and gives a reason where one is asked for.
  async function act(
    adminId: string,
    userId: string,
    action: AdminActionKind,
    permission: StaffPermission,
    run: () => Promise<AccountAction | AdminActionInput | null>
  ): Promise<AccountAction> {
    if (!(await deps.staff.can(adminId, permission))) return { status: 'forbidden' };
    if (action !== 'badge' && (await deps.staff.memberIds()).includes(userId))
      return { status: 'cannot_moderate_admin' };
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
    const permission = BLOCK_SPANS[input.duration] === null ? 'accounts.manage' : 'accounts.moderate';
    return act(adminId, userId, 'block', permission, async () => {
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
    // A block for good is lifted by those who may give one.
    const blocked = (await deps.accounts().detail(userId, now()))?.account.blocked;
    const permission = blocked && blocked.until === null ? 'accounts.manage' : 'accounts.moderate';
    return act(adminId, userId, 'unblock', permission, async () => {
      if (!(await deps.standing().unblock({ userId, now: now() }))) return null;
      return { adminUserId: adminId, targetUserId: userId, action: 'unblock' };
    });
  }

  async function signOutEverywhere(adminId: string, userId: string): Promise<AccountAction> {
    return act(adminId, userId, 'logout', 'accounts.moderate', async () => {
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
    return act(adminId, userId, 'delete', 'accounts.manage', async () => {
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
    return act(adminId, userId, 'cancel_deletion', 'accounts.manage', async () => {
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
    return act(adminId, userId, 'badge', 'accounts.manage', async () => {
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
