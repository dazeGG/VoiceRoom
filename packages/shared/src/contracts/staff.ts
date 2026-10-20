// /api/staff/*: who runs the service and what each of them may do. A staff
// member is an account with a role; the role is a set of permissions, so a
// check asks for the permission, never for the role. The admin app at its own
// subdomain signs in through the main site (a one-time code, see the API's
// staff domain) and asks /api/staff/me what to show.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const STAFF_ROLES = ['moderator', 'admin', 'superadmin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const StaffRoleSchema = Type.Union([
  Type.Literal('moderator'),
  Type.Literal('admin'),
  Type.Literal('superadmin')
]);

export const STAFF_PERMISSIONS = [
  /** Open reports: read and resolve them. */
  'reports.review',
  /** Who is in voice now and the history of stays. */
  'rooms.view',
  /** Where a stay came from: the address key, the city and a guest's browser id. */
  'origin.view',
  /** The accounts list and an account's card. */
  'accounts.view',
  /** A block with an end date, and signing an account out everywhere. */
  'accounts.moderate',
  /** A block without an end, deletion and badges. */
  'accounts.manage',
  /** The overview, product and server numbers, and call feedback. */
  'stats.view',
  /** Give and take staff roles. */
  'staff.manage'
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export const StaffPermissionSchema = Type.Union([
  Type.Literal('reports.review'),
  Type.Literal('rooms.view'),
  Type.Literal('origin.view'),
  Type.Literal('accounts.view'),
  Type.Literal('accounts.moderate'),
  Type.Literal('accounts.manage'),
  Type.Literal('stats.view'),
  Type.Literal('staff.manage')
]);

const MODERATOR: readonly StaffPermission[] = ['reports.review', 'rooms.view', 'accounts.view', 'accounts.moderate'];
const ADMIN: readonly StaffPermission[] = [...MODERATOR, 'origin.view', 'accounts.manage', 'stats.view'];

export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly StaffPermission[]>> = Object.freeze({
  moderator: MODERATOR,
  admin: ADMIN,
  superadmin: [...ADMIN, 'staff.manage']
});

export function roleAllows(role: StaffRole | null, permission: StaffPermission): boolean {
  return role !== null && ROLE_PERMISSIONS[role].includes(permission);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return STAFF_ROLES.some((role) => role === value);
}

/** The roles in rank order, lowest first. */
export function roleRank(role: StaffRole): number {
  return STAFF_ROLES.indexOf(role);
}

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = Object.freeze({
  moderator: 'Модератор',
  admin: 'Администратор',
  superadmin: 'Суперадминистратор'
});

/** On the main site: whether this account is staff, and where the admin app lives. */
export const StaffAccess = Ok({
  staff: Type.Boolean(),
  adminUrl: Nullable(Type.String()),
  /** Open reports, for staff who review them; 0 for everyone else. */
  openReports: Type.Number()
});
export type StaffAccess = Static<typeof StaffAccess>;

const StaffAccount = Type.Object({
  id: Type.String(),
  login: Type.String(),
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarAccent: Nullable(Type.String())
});

/** In the admin app: who is signed in and what they may do. */
export const StaffMe = Ok({
  user: StaffAccount,
  role: StaffRoleSchema,
  permissions: Type.Array(StaffPermissionSchema),
  /** The main site, for links back to it. */
  siteUrl: Type.String()
});
export type StaffMe = Static<typeof StaffMe>;

export const StaffMember = Type.Object({
  user: StaffAccount,
  role: StaffRoleSchema,
  /** Named in the server's settings: always a superadmin, and the panel cannot change that. */
  fixed: Type.Boolean()
});
export type StaffMember = Static<typeof StaffMember>;

export const StaffList = Ok({ staff: Type.Array(StaffMember) });
export type StaffList = Static<typeof StaffList>;

/** Give a role by login, or take it away with null. */
export const StaffRoleBody = Type.Object({
  login: Type.String({ minLength: 1, maxLength: 64 }),
  role: Nullable(StaffRoleSchema)
});
export type StaffRoleBody = Static<typeof StaffRoleBody>;
