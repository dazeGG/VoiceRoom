// Who is signed in to the admin app and what they may do, for every section.

import { createContext, useContext } from 'react';
import type { StaffMe, StaffPermission } from '@voice-room/shared/contracts/staff';

export type Staff = Omit<StaffMe, 'ok'>;

export const StaffContext = createContext<Staff | null>(null);

export function useStaff(): Staff {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error('useStaff outside the signed-in app');
  return staff;
}

/** Whether the signed-in staff member has this permission. */
export function useCan(permission: StaffPermission): boolean {
  return useStaff().permissions.includes(permission);
}
