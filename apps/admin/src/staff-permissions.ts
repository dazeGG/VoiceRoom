// How the staff section words each permission, in the groups it shows them
// in, and what each role may do and open, worked out from the roles
// themselves (ROLE_PERMISSIONS) and the menu (TAB_PERMISSIONS), so the table
// of rights never drifts from what the server checks.

import {
  ROLE_PERMISSIONS,
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  type StaffPermission,
  type StaffRole
} from '@voice-room/shared/contracts/staff';
import { ADMIN_TABS, TAB_LABELS, TAB_PERMISSIONS, allowedTabs } from './tabs.ts';

type PermissionGroup = 'Модерация' | 'Аккаунты' | 'Аналитика' | 'Команда';

const GROUP_ORDER: readonly PermissionGroup[] = ['Модерация', 'Аккаунты', 'Аналитика', 'Команда'];

/** Every permission must have its words: a new one in the contract fails the type check here. */
const PERMISSION_TEXT: Record<StaffPermission, { group: PermissionGroup; title: string }> = {
  'reports.review': { group: 'Модерация', title: 'Разбирать жалобы' },
  'rooms.view': { group: 'Модерация', title: 'Смотреть комнаты' },
  'origin.view': { group: 'Модерация', title: 'Видеть, откуда заходили' },
  'accounts.view': { group: 'Аккаунты', title: 'Открывать аккаунты' },
  'accounts.moderate': { group: 'Аккаунты', title: 'Блокировать на время и разлогинивать' },
  'accounts.manage': { group: 'Аккаунты', title: 'Блокировать навсегда, удалять и ставить отметки' },
  'stats.view': { group: 'Аналитика', title: 'Смотреть статистику' },
  'staff.manage': { group: 'Команда', title: 'Выдавать и снимать роли' }
};

export interface PermissionRow {
  permission: StaffPermission;
  title: string;
  /**
   * The menu sections this permission opens, when it opens several; one that
   * opens a single section is named after it already.
   */
  opens: string;
  /** Whether each role has it. */
  roles: Record<StaffRole, boolean>;
}

function sectionsOpenedBy(permission: StaffPermission): string {
  const sections = ADMIN_TABS.filter((tab) => TAB_PERMISSIONS[tab] === permission).map((tab) => TAB_LABELS[tab]);
  return sections.length > 1 ? sections.join(', ') : '';
}

/** The permissions in their groups, each with who has it. */
export function permissionGroups(): { label: PermissionGroup; rows: PermissionRow[] }[] {
  return GROUP_ORDER.map((label) => ({
    label,
    rows: STAFF_PERMISSIONS.filter((permission) => PERMISSION_TEXT[permission].group === label).map((permission) => ({
      permission,
      title: PERMISSION_TEXT[permission].title,
      opens: sectionsOpenedBy(permission),
      roles: {
        moderator: ROLE_PERMISSIONS.moderator.includes(permission),
        admin: ROLE_PERMISSIONS.admin.includes(permission),
        superadmin: ROLE_PERMISSIONS.superadmin.includes(permission)
      }
    }))
  })).filter((group) => group.rows.length > 0);
}

/** The menu sections a role sees, in the menu's order. */
export function sectionsOf(role: StaffRole): string[] {
  return allowedTabs(ROLE_PERMISSIONS[role]).map((tab) => TAB_LABELS[tab]);
}

/** Whether every role may do all the one below it may: the table then reads as a ladder. */
export function rolesAreNested(): boolean {
  return STAFF_ROLES.every(
    (role, index) =>
      index === 0 ||
      ROLE_PERMISSIONS[STAFF_ROLES[index - 1] ?? role].every((permission) =>
        ROLE_PERMISSIONS[role].includes(permission)
      )
  );
}
