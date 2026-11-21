// Renders a React section as a staff member of some role.
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { StaffRole } from '@voice-room/shared/contracts/staff';
import { StaffContext } from '../../src/staff.tsx';
import { staffOf } from './api.ts';

export { staffOf, stubApi, type Call, type Reply, type Route } from './api.ts';

/** Renders a section as a staff member with `role` (an admin unless said). */
export function renderAs(ui: ReactElement, role: StaffRole = 'admin') {
  return render(<StaffContext.Provider value={staffOf(role)}>{ui}</StaffContext.Provider>);
}
