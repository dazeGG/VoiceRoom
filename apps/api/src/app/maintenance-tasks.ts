// The periodic sweeps a running API performs (platform/maintenance.ts runs
// them): idle rooms, product and system snapshots, sessions, sign-in history, finished
// account deletions, expired link previews, deleted-message retention, the
// rooms of old stays in voice and the authors of old call feedback.

import { VOICE_HISTORY_KEEP_DAYS } from '@voice-room/shared/contracts/admin';
import type { MaintenanceTask } from '../platform/maintenance.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ApiMaintenanceDeps {
  pruneRooms(): Promise<unknown>;
  sampleProduct(): Promise<unknown>;
  sampleSystem(): Promise<unknown>;
  users(): { pruneSessions(): Promise<unknown>; pruneLoginEvents(): Promise<unknown> };
  finalizeDueDeletions(): Promise<unknown>;
  linkPreviews(): { pruneExpired(): Promise<unknown> } | null;
  rooms(): { purgeDeleted?: (options: { olderThanMs: number }) => Promise<unknown> };
  voiceSessions(): { forgetRoomsBefore(cutoff: Date): Promise<unknown> } | null;
  callFeedback(): { forgetAuthorsBefore(cutoff: Date): Promise<unknown> } | null;
  now?: () => number;
  retention: { intervalMs: number; keepDeletedMs: number };
}

export function apiMaintenanceTasks(deps: ApiMaintenanceDeps): MaintenanceTask[] {
  const now = deps.now ?? Date.now;
  return [
    {
      name: 'room_prune',
      label: 'room-prune',
      failureMessage: 'room prune timer failed',
      run: () => deps.pruneRooms()
    },
    {
      name: 'product_snapshot',
      label: 'product-snapshot',
      failureMessage: 'product snapshot timer failed',
      run: () => deps.sampleProduct()
    },
    {
      name: 'system_snapshot',
      label: 'system-snapshot',
      failureMessage: 'system snapshot timer failed',
      run: () => deps.sampleSystem()
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
    },
    {
      name: 'voice_history_forget',
      label: 'voice-history-forget',
      failureMessage: 'voice history forget timer failed',
      enabled: () => Boolean(deps.voiceSessions()),
      run: async () => deps.voiceSessions()?.forgetRoomsBefore(new Date(now() - VOICE_HISTORY_KEEP_DAYS * DAY_MS))
    },
    {
      // An answer about a call says who was in which room as long as a stay in
      // voice does, then keeps only the room and what was said.
      name: 'call_feedback_forget',
      label: 'call-feedback-forget',
      failureMessage: 'call feedback forget timer failed',
      enabled: () => Boolean(deps.callFeedback()),
      run: async () => deps.callFeedback()?.forgetAuthorsBefore(new Date(now() - VOICE_HISTORY_KEEP_DAYS * DAY_MS))
    }
  ];
}
