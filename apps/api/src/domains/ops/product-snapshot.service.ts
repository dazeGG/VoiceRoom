// One maintenance tick of product analytics: the live numbers raise their
// quarter hour's peaks, and every account with an open socket is marked
// active for the day.

import type { ProductSnapshotRepository } from './product-snapshot.repository.ts';

export const SNAPSHOT_BUCKET_MS = 15 * 60 * 1000;

export type LiveNumbers = {
  /** The accounts with at least one open realtime socket. */
  accountIds: Iterable<string>;
  guestConnections: number;
  voicePeers: number;
  voiceRooms: number;
};

export interface ProductSamplerDeps {
  live(): LiveNumbers;
  snapshots(): Pick<ProductSnapshotRepository, 'recordPeaks'> | null;
  activity: { sawConnected(userIds: Iterable<string>): void };
  now?: () => number;
}

export function createProductSampler(deps: ProductSamplerDeps) {
  const now = deps.now ?? Date.now;

  async function sample(): Promise<void> {
    const live = deps.live();
    const accountIds = [...new Set(live.accountIds)];
    deps.activity.sawConnected(accountIds);
    const at = now();
    await deps.snapshots()?.recordPeaks({
      at: new Date(at - (at % SNAPSHOT_BUCKET_MS)),
      onlineAccounts: accountIds.length,
      guestConnections: live.guestConnections,
      voicePeers: live.voicePeers,
      voiceRooms: live.voiceRooms
    });
  }

  return { sample };
}
