// Guest identities: a peer id in a room, bound to the hash of the session token
// that first claimed it. Rejoining with the same token reuses the identity; a
// different token is refused.

import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import { cleanAvatarColorKey } from '@voice-room/shared/validation';
import type { Database } from '../../platform/db/kysely.ts';
import type { RoomPeerIdentities } from '../../platform/db/schema.ts';
import { avatarColorForPeerId } from './avatar-color.ts';
import { createRowId, toDate, toMillis } from './room.repository.ts';

export type PeerIdentity = ReturnType<typeof mapPeerIdentity>;
export type PeerIdentityClaim =
  { identity: null; status: 'invalid' } | { identity: PeerIdentity; status: 'created' | 'reused' | 'token_mismatch' };

function hashPeerSessionToken(sessionToken: unknown): string {
  return crypto
    .createHash('sha256')
    .update(typeof sessionToken === 'string' ? sessionToken : '')
    .digest('hex');
}

function hashesMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected !== 'string' || typeof actual !== 'string' || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function mapPeerIdentity(row: Selectable<RoomPeerIdentities>) {
  return {
    avatarColorKey: row.avatar_color_key || avatarColorForPeerId(row.peer_id),
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    id: row.id || '',
    lastSeenAt: toMillis(row.last_seen_at),
    peerId: row.peer_id || '',
    roomId: row.room_id,
    sessionTokenHash: row.session_token_hash || ''
  };
}

export function createPeerIdentityRepository({ db }: { db: Database }) {
  async function getOrCreatePeerIdentity({
    roomId,
    peerId,
    sessionToken,
    displayName = '',
    avatarColorKey = '',
    now = Date.now()
  }: {
    roomId: string;
    peerId: string;
    sessionToken: unknown;
    displayName?: unknown;
    avatarColorKey?: unknown;
    now?: number;
  }): Promise<PeerIdentityClaim | null> {
    if (!roomId || !peerId || !sessionToken) return { identity: null, status: 'invalid' };
    const sessionTokenHash = hashPeerSessionToken(sessionToken);
    const seenAt = toDate(now);
    const nextDisplayName = typeof displayName === 'string' ? displayName : '';
    const preferredAvatarColorKey = cleanAvatarColorKey(avatarColorKey);

    async function reuseExisting(trx: Database, status: 'reused' = 'reused'): Promise<PeerIdentityClaim | null> {
      const identity = await trx
        .selectFrom('room_peer_identities')
        .selectAll()
        .where('room_id', '=', roomId)
        .where('peer_id', '=', peerId)
        .forUpdate()
        .executeTakeFirst();
      if (!identity) return null;
      if (!hashesMatch(identity.session_token_hash, sessionTokenHash)) {
        return { identity: mapPeerIdentity(identity), status: 'token_mismatch' };
      }
      const updated = await trx
        .updateTable('room_peer_identities')
        .set({
          display_name: nextDisplayName,
          last_seen_at: seenAt,
          avatar_color_key: preferredAvatarColorKey ? preferredAvatarColorKey : sql<string>`avatar_color_key`,
          metadata: sql`COALESCE(metadata, '{}'::jsonb)`
        })
        .where('room_id', '=', roomId)
        .where('peer_id', '=', peerId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { identity: mapPeerIdentity(updated), status };
    }

    return db.transaction().execute(async (trx): Promise<PeerIdentityClaim | null> => {
      const existing = await reuseExisting(trx);
      if (existing) return existing;

      const inserted = await trx
        .insertInto('room_peer_identities')
        .values({
          id: createRowId(),
          room_id: roomId,
          peer_id: peerId,
          session_token_hash: sessionTokenHash,
          avatar_color_key: preferredAvatarColorKey || avatarColorForPeerId(`${roomId}:${peerId}:${sessionTokenHash}`),
          display_name: nextDisplayName,
          created_at: seenAt,
          last_seen_at: seenAt
        })
        .onConflict((oc) => oc.columns(['room_id', 'peer_id']).doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return { identity: mapPeerIdentity(inserted), status: 'created' };
      // Someone claimed it between the lookup and the insert.
      return reuseExisting(trx, 'reused');
    });
  }

  // Replaces the token hash with one nobody holds, so the next join with the
  // old token is refused.
  async function invalidatePeerIdentity({
    roomId,
    peerId,
    now = Date.now()
  }: { roomId?: string; peerId?: string; now?: number } = {}): Promise<boolean> {
    if (!roomId || !peerId) return false;
    const result = await db
      .updateTable('room_peer_identities')
      .set({
        session_token_hash: hashPeerSessionToken(`invalidated:${createRowId()}`),
        last_seen_at: toDate(now)
      })
      .where('room_id', '=', roomId)
      .where('peer_id', '=', peerId)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  return { getOrCreatePeerIdentity, invalidatePeerIdentity };
}
