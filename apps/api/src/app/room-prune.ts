import type { MaintenanceTask } from '../platform/maintenance.ts';

export function roomPruneTask(prune: () => Promise<unknown>): MaintenanceTask {
  return { name: 'room_prune', label: 'room-prune', failureMessage: 'room prune timer failed', run: prune };
}
