// The admin panel's widgets section: whether rooms are taken from websites,
// the limits the server runs them with and today's widget calls. Read only:
// admission is turned on and off by an operator on the server
// (scripts/cd/activate-widget.sh), never over HTTP. A staff member without
// rooms.view gets null, which the route answers with 403.

import type { AdminWidgets } from '@voiceroom/shared/contracts/admin';
import type { StaffCheck } from '../staff/staff-check.ts';
import type { AdminRoomsRepository } from './admin-rooms.repository.ts';
import type { AdminStatsRepository, LiveCall } from './admin-stats.repository.ts';

export interface AdminWidgetsServiceDeps {
  staff: StaffCheck;
  rooms(): Pick<AdminRoomsRepository, 'widgetState'>;
  stats(): Pick<AdminStatsRepository, 'widgetToday'>;
  /** The calls going on now, for telling them from the finished ones. */
  liveCalls(): LiveCall[];
  /** WIDGET_ENABLED of this process. */
  flagEnabled: boolean;
  limits: AdminWidgets['limits'];
}

export function createAdminWidgetsService(deps: AdminWidgetsServiceDeps) {
  async function widgets(userId: string): Promise<Omit<AdminWidgets, 'ok'> | null> {
    if (!(await deps.staff.can(userId, 'rooms.view'))) return null;
    const [state, today] = await Promise.all([deps.rooms().widgetState(), deps.stats().widgetToday(deps.liveCalls())]);
    return {
      state: { ...state, flagEnabled: deps.flagEnabled },
      limits: deps.limits,
      today
    };
  }

  return Object.freeze({ widgets });
}

export type AdminWidgetsService = ReturnType<typeof createAdminWidgetsService>;
