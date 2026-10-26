// The periodic sweeps a running API performs (platform/maintenance.ts runs
// them): idle rooms, product and system snapshots, sessions, sign-in history, finished
// account deletions, expired link previews, deleted-message retention, the
// rooms of old stays in voice, the authors of old call feedback and expired
// admin-app sessions, the guest bans still stored by address, and the daily
// roll-up of old activity into counts.

import { VOICE_HISTORY_KEEP_DAYS } from '@voice-room/shared/contracts/admin';
import type { MaintenanceTask } from '../platform/maintenance.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Moscow keeps UTC+3 all year: its day is the UTC day three hours on. */
const moscowDay = (at: number) => new Date(at + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

export interface ApiMaintenanceDeps {
  pruneRooms(): Promise<unknown>;
  sampleProduct(): Promise<unknown>;
  sampleSystem(): Promise<unknown>;
  users(): { pruneSessions(): Promise<unknown>; pruneLoginEvents(): Promise<unknown> };
  finalizeDueDeletions(): Promise<unknown>;
  linkPreviews(): { pruneExpired(): Promise<unknown> } | null;
  rooms(): { purgeDeleted?: (options: { olderThanMs: number }) => Promise<unknown> };
  voiceSessions(): {
    forgetRoomsBefore(cutoff: Date): Promise<unknown>;
    forgetAccountsBefore(cutoffDay: string): Promise<unknown>;
  } | null;
  callFeedback(): { forgetAuthorsBefore(cutoff: Date): Promise<unknown> } | null;
  staffSessions?: (() => { pruneSessions(now: Date): Promise<unknown> } | null) | undefined;
  roomBans(): { keyStoredAddresses(): Promise<unknown> } | null;
  productStats(): { rollUp(cutoffDay: string, today: string): Promise<unknown> } | null;
  activity(): { forgetBefore(cutoffDay: string): Promise<unknown> } | null;
  now?: () => number;
  retention: { intervalMs: number; keepDeletedMs: number };
}

export function apiMaintenanceTasks(deps: ApiMaintenanceDeps): MaintenanceTask[] {
  const now = deps.now ?? Date.now;
  // The cutoff moves once a day, so the roll-up runs once a Moscow day (and at start).
  let rolledUpOn = '';
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
    },
    {
      name: 'staff_session_prune',
      label: 'staff-session-prune',
      failureMessage: 'staff session prune timer failed',
      enabled: () => Boolean(deps.staffSessions?.()),
      run: async () => deps.staffSessions?.()?.pruneSessions(new Date(now()))
    },
    {
      // Bans written before 2.10.4, or by an older replica during a deploy,
      // hold a guest's address; this keys them. With none left it finds none.
      name: 'room_ban_ip_key',
      label: 'room-ban-ip-key',
      failureMessage: 'room ban address keying timer failed',
      enabled: () => Boolean(deps.roomBans()),
      run: async () => deps.roomBans()?.keyStoredAddresses()
    },
    {
      // Who was active or in voice is kept per person for VOICE_HISTORY_KEEP_DAYS:
      // older days are counted first (admin-stats.repository rollUp), then their
      // owners forget whose they were.
      name: 'activity_rollup',
      label: 'activity-rollup',
      failureMessage: 'activity roll-up timer failed',
      enabled: () => Boolean(deps.productStats()) && rolledUpOn !== moscowDay(now()),
      run: async () => {
        const day = moscowDay(now());
        const cutoffDay = moscowDay(now() - VOICE_HISTORY_KEEP_DAYS * DAY_MS);
        await deps.productStats()?.rollUp(cutoffDay, day);
        await deps.activity()?.forgetBefore(cutoffDay);
        await deps.voiceSessions()?.forgetAccountsBefore(cutoffDay);
        rolledUpOn = day;
      }
    }
  ];
}
