// What a domain service needs from staff roles: whether an account may do one
// thing right now. Roles live in the staff domain; services ask for permissions.

import type { StaffPermission } from '@voice-room/shared/contracts/staff';

export interface StaffCheck {
  can(userId: string, permission: StaffPermission): Promise<boolean>;
}
