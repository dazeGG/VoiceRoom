// A stay's network as its own client judges it (room.peer.update `network`):
// each change, stamped with the server's clock, for the admin panel's call bars.

import { NETWORK_POINTS_MAX, type NetworkLevel, type NetworkPoint } from '@voice-room/shared/contracts/rooms';

const RANK: Record<NetworkLevel, number> = { good: 0, unstable: 1, bad: 2 };

/**
 * Adds `level`, heard at `at`, to a stay's changes. A repeat adds nothing; past
 * NETWORK_POINTS_MAX the last change only ever gets worse, so a long call that
 * flaps keeps its bad stretches.
 */
export function noteNetworkLevel(points: NetworkPoint[], level: NetworkLevel, at: number): void {
  const last = points.at(-1);
  if (last?.level === level) return;
  if (points.length < NETWORK_POINTS_MAX) {
    points.push({ at: Math.max(at, last?.at ?? at), level });
    return;
  }
  if (last && RANK[level] > RANK[last.level]) last.level = level;
}

/** The level a stay is at now; null until its client says. */
export const currentNetworkLevel = (points: readonly NetworkPoint[] | undefined): NetworkLevel | null =>
  points?.at(-1)?.level ?? null;
