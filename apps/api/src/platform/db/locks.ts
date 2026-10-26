// Transaction-scoped advisory locks. Every key lives here, so two writers that
// must exclude each other name the same builder instead of repeating a string.

import { sql } from 'kysely';
import type { Database } from './kysely.ts';

export const lockKeys = {
  // Every ban writer takes this before roomBans (always admission first), so a ban and the
  // membership write for the same room wait for each other.
  admission: (roomId: string) => `voice-room:admission:${roomId}`,
  // Bans in one room: the cap and the one-live-ban-per-subject rule hold under concurrent bans.
  roomBans: (roomId: string) => `voice-room:room-bans:${roomId}`,
  // One account's membership in one room.
  membership: (roomId: string, userId: string) => `voice-room:membership:${roomId}:${userId}`,
  // Two accounts' friendship and invite state; the ids come ordered.
  userPair: (low: string, high: string) => `voice-room:user-pair:${low}:${high}`,
  // Ring creation takes request identity before userPair, even for different recipients.
  ringRequest: (caller: string, requestId: string) => `voice-room:ring-request:${caller}:${requestId.toLowerCase()}`
};

/** Holds until the caller's transaction ends. */
export async function lockXact(db: Database, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(db);
}
