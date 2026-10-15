// The peak live numbers of each quarter hour, kept for good: Prometheus only
// holds them for its retention. The only writer of product_snapshots.

import type pg from 'pg';
import { sql } from 'kysely';
import { kyselyOn } from '../../platform/db/kysely.ts';

export type ProductSnapshot = {
  /** The start of the quarter hour. */
  at: Date;
  onlineAccounts: number;
  guestConnections: number;
  voicePeers: number;
  voiceRooms: number;
};

export function createProductSnapshotRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** Raises the quarter hour's numbers to these where they are higher. */
  async function recordPeaks(snapshot: ProductSnapshot): Promise<void> {
    await db
      .insertInto('product_snapshots')
      .values({
        at: snapshot.at,
        online_accounts: snapshot.onlineAccounts,
        guest_connections: snapshot.guestConnections,
        voice_peers: snapshot.voicePeers,
        voice_rooms: snapshot.voiceRooms
      })
      .onConflict((conflict) =>
        conflict.column('at').doUpdateSet({
          online_accounts: sql<number>`GREATEST(product_snapshots.online_accounts, excluded.online_accounts)`,
          guest_connections: sql<number>`GREATEST(product_snapshots.guest_connections, excluded.guest_connections)`,
          voice_peers: sql<number>`GREATEST(product_snapshots.voice_peers, excluded.voice_peers)`,
          voice_rooms: sql<number>`GREATEST(product_snapshots.voice_rooms, excluded.voice_rooms)`
        })
      )
      .execute();
  }

  return Object.freeze({ recordPeaks });
}

export type ProductSnapshotRepository = ReturnType<typeof createProductSnapshotRepository>;
