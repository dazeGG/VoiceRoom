// Who runs the service and what each of them may do, and how the admin app on
// its own subdomain gets a session of its own. The app never sees a password:
// the main site, where the account is already signed in, hands it a one-time
// code (handoff), and the app trades the code for a session cookie that lives
// only on its subdomain (exchange). Every request then re-reads the account, so
// a lost role, a block or signing out on the main site ends the access at once.

import crypto from 'node:crypto';
import {
  ROLE_PERMISSIONS,
  roleAllows,
  roleRank,
  type StaffList,
  type StaffMe,
  type StaffPermission,
  type StaffRole
} from '@voice-room/shared/contracts/staff';
import { normalizeLogin } from '@voice-room/shared/validation';
import type { AdminActionRepository } from '../admin/admin-action.repository.ts';
import type { StaffAccountRow, StaffRepository } from './staff.repository.ts';

/** How long a handed-over code may wait to be traded; one browser redirect needs well under it. */
export const HANDOFF_CODE_TTL_MS = 60_000;
/** How long an admin-app session lasts before another handoff. */
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface StaffActor {
  userId: string;
  role: StaffRole;
}

export interface StaffServiceDeps {
  /** PLATFORM_ADMIN_USER_IDS: always superadmins, whatever their accounts say. */
  namedSuperadminIds: readonly string[];
  repository(): StaffRepository;
  actions(): Pick<AdminActionRepository, 'record'>;
  /** The main site and the admin app, as origins (https://voiceroom.ru). */
  siteOrigin: string;
  now?: () => number;
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

export type RoleChange = { status: 'done' } | { status: 'forbidden' | 'not_found' | 'fixed' | 'self' };

export function createStaffService(deps: StaffServiceDeps) {
  const now = deps.now ?? Date.now;
  // One process serves the API, so the codes waiting to be traded live here.
  const codes = new Map<string, { userId: string; mainSessionId: string; expiresAt: number }>();

  function roleOf(account: StaffAccountRow | null): StaffRole | null {
    if (!account) return null;
    if (deps.namedSuperadminIds.includes(account.id)) return 'superadmin';
    return account.storedRole;
  }

  /** The account's role now; null for anyone who is not staff (or is blocked, or gone). */
  async function role(userId: string | null | undefined): Promise<StaffRole | null> {
    if (!userId) return null;
    return roleOf(await deps.repository().account(userId));
  }

  async function can(userId: string | null | undefined, permission: StaffPermission): Promise<boolean> {
    return roleAllows(await role(userId), permission);
  }

  function dropExpiredCodes(): void {
    const at = now();
    for (const [code, entry] of codes) if (entry.expiresAt <= at) codes.delete(code);
  }

  /** On the main site: a one-time code for this staff member's main session, or null when they are not staff. */
  async function handoff(userId: string, mainSessionId: string): Promise<string | null> {
    if (!mainSessionId || !(await role(userId))) return null;
    dropExpiredCodes();
    const code = randomToken();
    codes.set(sha256(code), { userId, mainSessionId, expiresAt: now() + HANDOFF_CODE_TTL_MS });
    return code;
  }

  /** On the admin app: the code traded for a session token, once. Null when it is unknown, used or late. */
  async function exchange(code: string): Promise<{ token: string; maxAgeSeconds: number } | null> {
    const key = sha256(code);
    const entry = codes.get(key);
    codes.delete(key);
    if (!entry || entry.expiresAt <= now() || !(await role(entry.userId))) return null;
    const token = randomToken();
    await deps.repository().openSession({
      id: sha256(token),
      userId: entry.userId,
      mainSessionId: entry.mainSessionId,
      expiresAt: new Date(now() + STAFF_SESSION_TTL_MS)
    });
    return { token, maxAgeSeconds: STAFF_SESSION_TTL_MS / 1000 };
  }

  /** Who is behind an admin-app session token, with the role they have now. */
  async function actor(token: string): Promise<(StaffActor & { account: StaffAccountRow }) | null> {
    if (!token) return null;
    const account = await deps.repository().sessionAccount(sha256(token), new Date(now()));
    const current = roleOf(account);
    return account && current ? { userId: account.id, role: current, account } : null;
  }

  async function signOut(token: string): Promise<void> {
    if (token) await deps.repository().closeSession(sha256(token));
  }

  function me(actor: StaffActor & { account: StaffAccountRow }): Omit<StaffMe, 'ok'> {
    const { storedRole: _stored, ...user } = actor.account;
    return { user, role: actor.role, permissions: [...ROLE_PERMISSIONS[actor.role]], siteUrl: deps.siteOrigin };
  }

  /** The ids of every staff account right now. */
  async function memberIds(): Promise<string[]> {
    const accounts = await deps.repository().members(deps.namedSuperadminIds);
    return accounts.filter((account) => roleOf(account)).map((account) => account.id);
  }

  async function list(actor: StaffActor): Promise<Omit<StaffList, 'ok'> | null> {
    if (!roleAllows(actor.role, 'staff.manage')) return null;
    const accounts = await deps.repository().members(deps.namedSuperadminIds);
    return {
      staff: accounts.flatMap((account) => {
        const current = roleOf(account);
        if (!current) return [];
        const { storedRole: _stored, ...user } = account;
        return [{ user, role: current, fixed: deps.namedSuperadminIds.includes(account.id) }];
      })
    };
  }

  /** Give a role to an account by login, or take it away with null. */
  async function setRole(actor: StaffActor, login: string, next: StaffRole | null): Promise<RoleChange> {
    if (!roleAllows(actor.role, 'staff.manage')) return { status: 'forbidden' };
    const target = await deps.repository().accountByLogin(normalizeLogin(login));
    if (!target) return { status: 'not_found' };
    if (target.id === actor.userId) return { status: 'self' };
    if (deps.namedSuperadminIds.includes(target.id)) return { status: 'fixed' };
    // Only a superadmin manages staff, so the ranks never let someone outrank themselves.
    if (next && roleRank(next) > roleRank(actor.role)) return { status: 'forbidden' };
    await deps.repository().setRole(target.id, next);
    await deps
      .actions()
      .record({ adminUserId: actor.userId, targetUserId: target.id, action: 'staff_role', role: next });
    return { status: 'done' };
  }

  return Object.freeze({ role, can, memberIds, handoff, exchange, actor, signOut, me, list, setRole });
}

export type StaffService = ReturnType<typeof createStaffService>;
