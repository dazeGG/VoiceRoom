// The periodic sweeps a running API performs (platform/maintenance.ts runs
// them): idle rooms, sessions, sign-in history, finished account deletions,
// expired link previews and deleted-message retention.

import type { MaintenanceTask } from '../platform/maintenance.ts';

export interface ApiMaintenanceDeps {
  pruneRooms(): Promise<unknown>;
  users(): { pruneSessions(): Promise<unknown>; pruneLoginEvents(): Promise<unknown> };
  finalizeDueDeletions(): Promise<unknown>;
  linkPreviews(): { pruneExpired(): Promise<unknown> } | null;
  rooms(): { purgeDeleted?: (options: { olderThanMs: number }) => Promise<unknown> };
  retention: { intervalMs: number; keepDeletedMs: number };
}

export function apiMaintenanceTasks(deps: ApiMaintenanceDeps): MaintenanceTask[] {
  return [
    {
      name: 'room_prune',
      label: 'room-prune',
      failureMessage: 'room prune timer failed',
      run: () => deps.pruneRooms()
    },
    {
      name: 'session_prune',
      label: 'session-prune',
      failureMessage: 'session prune timer failed',
      run: () => deps.users().pruneSessions()
    },
    {
      name: 'login_event_prune',
      label: 'sign-in-history-prune',
      failureMessage: 'sign-in history prune timer failed',
      run: () => deps.users().pruneLoginEvents()
    },
    {
      name: 'account_deletion_finalize',
      label: 'account-deletion',
      failureMessage: 'account deletion timer failed',
      run: () => deps.finalizeDueDeletions()
    },
    {
      name: 'link_preview_prune',
      label: 'link-preview-prune',
      failureMessage: 'link preview prune timer failed',
      enabled: () => Boolean(deps.linkPreviews()),
      run: async () => deps.linkPreviews()?.pruneExpired()
    },
    {
      name: 'retention_purge',
      label: 'retention-purge',
      failureMessage: 'retention purge timer failed',
      enabled: () => deps.retention.intervalMs > 0 && Boolean(deps.rooms().purgeDeleted),
      run: async () => deps.rooms().purgeDeleted?.({ olderThanMs: deps.retention.keepDeletedMs })
    }
  ];
}
