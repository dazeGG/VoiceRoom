import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { cleanPresenceStatus } from '@voice-room/shared/validation';
import type { NotificationLevel, NotificationPreferences } from '@voice-room/shared/contracts/notifications';
import { kyselyOn, type Database, type Queryable } from '../platform/db/kysely.ts';
export type RoomNotificationLevel = NotificationLevel;
export type { NotificationPreferences };
type PreferencesInput = {
  doNotDisturb?: boolean;
  presenceStatus?: unknown;
  presenceStatusAutomatic?: unknown;
  privateNotifications?: unknown;
  mutedPeerIds?: string[];
  mutedRoomIds?: string[];
  roomLevels?: Record<string, RoomNotificationLevel>;
};
export type PreferencesResult<Status extends string> = { status: Status; preferences: NotificationPreferences };

const DEFAULT_AUTOMATIC_PRESENCE_LEASE_MS = 3 * 60 * 1000;

function isRoomLevel(value: unknown): value is RoomNotificationLevel {
  return value === 'all' || value === 'mentions' || value === 'none';
}

function createRowId(): string {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

function mapPreferences({
  doNotDisturb = false,
  presenceStatus = '',
  presenceStatusAutomatic = false,
  privateNotifications = false,
  mutedPeerIds = [],
  mutedRoomIds = [],
  roomLevels = {}
}: PreferencesInput = {}): NotificationPreferences {
  const normalizedPresenceStatus = cleanPresenceStatus(presenceStatus) || (doNotDisturb ? 'dnd' : 'online');
  return {
    doNotDisturb: normalizedPresenceStatus === 'dnd',
    mutedPeerIds: [...new Set(mutedPeerIds)].sort(),
    mutedRoomIds: [...new Set(mutedRoomIds)].sort(),
    roomLevels: { ...roomLevels },
    presenceStatus: normalizedPresenceStatus,
    presenceStatusAutomatic: normalizedPresenceStatus === 'away' && Boolean(presenceStatusAutomatic),
    privateNotifications: Boolean(privateNotifications)
  };
}

function createNotificationStore({
  automaticPresenceLeaseMs = DEFAULT_AUTOMATIC_PRESENCE_LEASE_MS,
  pool
}: {
  automaticPresenceLeaseMs?: number;
  pool: pg.Pool;
}) {
  const db = kyselyOn(pool);
  const activeLeaseMs =
    Number.isFinite(automaticPresenceLeaseMs) && automaticPresenceLeaseMs > 0
      ? Math.floor(automaticPresenceLeaseMs)
      : DEFAULT_AUTOMATIC_PRESENCE_LEASE_MS;
  // An online user stays "active" this long after their last sign of life.
  const activeLeaseEnd = sql<Date>`current_timestamp + (${activeLeaseMs} * interval '1 millisecond')`;
  const now = sql<Date>`current_timestamp`;

  async function preferencesOn(q: Database, userId: string): Promise<NotificationPreferences> {
    const preferences = await q
      .selectFrom('users as u')
      .leftJoin('notification_preferences as np', 'np.user_id', 'u.id')
      .select(['u.dnd', 'u.presence_status', 'u.presence_status_automatic', 'np.private_notifications'])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    const dmMutes = await q
      .selectFrom('notification_dm_mutes')
      .select('peer_user_id')
      .where('user_id', '=', userId)
      .orderBy('peer_user_id')
      .execute();
    const roomMutes = await q
      .selectFrom('notification_room_mutes')
      .select(['room_id', 'level'])
      .where('user_id', '=', userId)
      .orderBy('room_id')
      .execute();
    return mapPreferences({
      doNotDisturb: preferences?.dnd || false,
      presenceStatus: preferences?.presence_status,
      presenceStatusAutomatic: preferences?.presence_status_automatic,
      privateNotifications: preferences?.private_notifications || false,
      mutedPeerIds: dmMutes.map((row) => row.peer_user_id),
      mutedRoomIds: roomMutes.filter((row) => row.level === 'none').map((row) => row.room_id),
      roomLevels: Object.fromEntries(
        roomMutes.map((row) => [row.room_id, (row.level || 'none') as RoomNotificationLevel])
      )
    });
  }

  async function getPreferences(
    userId: string | null | undefined,
    client?: Queryable
  ): Promise<NotificationPreferences> {
    if (!userId) return mapPreferences();
    return preferencesOn(client ? kyselyOn(client) : db, userId);
  }

  async function userExists(q: Database, userId: string): Promise<boolean> {
    return Boolean(await q.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst());
  }

  async function setPrivateNotifications({
    userId,
    privateNotifications
  }: {
    userId: string;
    privateNotifications: unknown;
  }): Promise<PreferencesResult<'not_found' | 'updated'>> {
    if (!userId) return { status: 'not_found', preferences: mapPreferences() };
    return db.transaction().execute(async (trx): Promise<PreferencesResult<'not_found' | 'updated'>> => {
      if (!(await userExists(trx, userId))) {
        return { status: 'not_found', preferences: mapPreferences() };
      }
      await trx
        .insertInto('notification_preferences')
        .values({
          user_id: userId,
          private_notifications: Boolean(privateNotifications),
          created_at: now,
          updated_at: now
        })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet((eb) => ({
            private_notifications: eb.ref('excluded.private_notifications'),
            updated_at: now
          }))
        )
        .execute();
      return { status: 'updated', preferences: await preferencesOn(trx, userId) };
    });
  }

  async function setDoNotDisturb({
    userId,
    doNotDisturb
  }: {
    userId: string;
    doNotDisturb: unknown;
  }): Promise<PreferencesResult<'not_found' | 'updated'>> {
    if (!userId) return { status: 'not_found', preferences: mapPreferences() };
    const dnd = Boolean(doNotDisturb);
    return db.transaction().execute(async (trx): Promise<PreferencesResult<'not_found' | 'updated'>> => {
      const updated = await trx
        .updateTable('users')
        .set({
          dnd,
          presence_status: dnd ? 'dnd' : 'online',
          presence_status_automatic: false,
          presence_active_until: dnd ? null : activeLeaseEnd,
          updated_at: now
        })
        .where('id', '=', userId)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return { status: 'not_found', preferences: mapPreferences() };
      return { status: 'updated', preferences: await preferencesOn(trx, userId) };
    });
  }

  // A manual status always wins. Automatic idle detection may only move an
  // online user to away (when no other device holds the online lease) and back.
  async function setPresenceStatus({
    userId,
    presenceStatus,
    automatic = false
  }: {
    userId: string;
    presenceStatus: unknown;
    automatic?: unknown;
  }): Promise<PreferencesResult<'not_found' | 'invalid' | 'unchanged' | 'updated'>> {
    type Result = PreferencesResult<'not_found' | 'invalid' | 'unchanged' | 'updated'>;
    const normalizedPresenceStatus = cleanPresenceStatus(presenceStatus);
    if (!userId) return { status: 'not_found', preferences: mapPreferences() };
    if (!normalizedPresenceStatus) return { status: 'invalid', preferences: mapPreferences() };
    if (typeof automatic !== 'boolean') return { status: 'invalid', preferences: mapPreferences() };
    if (automatic && normalizedPresenceStatus !== 'away' && normalizedPresenceStatus !== 'online') {
      return { status: 'invalid', preferences: mapPreferences() };
    }
    return db.transaction().execute(async (trx): Promise<Result> => {
      const current = await trx
        .selectFrom('users')
        .select([
          'presence_status',
          'presence_status_automatic',
          sql<boolean | null>`presence_active_until > current_timestamp`.as('presence_has_active_lease')
        ])
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { status: 'not_found', preferences: mapPreferences() };

      const renewLease = () =>
        trx.updateTable('users').set({ presence_active_until: activeLeaseEnd }).where('id', '=', userId).execute();
      const currentStatus = cleanPresenceStatus(current.presence_status) || 'online';
      const currentAutomatic = currentStatus === 'away' && Boolean(current.presence_status_automatic);
      const hasActiveLease = Boolean(current.presence_has_active_lease);
      const nextStatus = normalizedPresenceStatus;
      let nextAutomatic = false;

      if (automatic) {
        const shouldEnterAway = normalizedPresenceStatus === 'away' && currentStatus === 'online' && !hasActiveLease;
        const shouldRenewOnline = normalizedPresenceStatus === 'online' && currentStatus === 'online';
        const shouldResumeOnline =
          normalizedPresenceStatus === 'online' && currentStatus === 'away' && currentAutomatic;
        if (shouldRenewOnline) {
          await renewLease();
          return { status: 'unchanged', preferences: await preferencesOn(trx, userId) };
        }
        if (!shouldEnterAway && !shouldResumeOnline) {
          return { status: 'unchanged', preferences: await preferencesOn(trx, userId) };
        }
        nextAutomatic = shouldEnterAway;
      }

      if (currentStatus === nextStatus && currentAutomatic === nextAutomatic) {
        if (nextStatus === 'online') await renewLease();
        return { status: 'unchanged', preferences: await preferencesOn(trx, userId) };
      }

      const updated = await trx
        .updateTable('users')
        .set({
          presence_status: nextStatus,
          dnd: nextStatus === 'dnd',
          presence_status_automatic: nextAutomatic,
          presence_active_until: nextStatus === 'online' ? activeLeaseEnd : null,
          updated_at: now
        })
        .where('id', '=', userId)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return { status: 'not_found', preferences: mapPreferences() };
      return { status: 'updated', preferences: await preferencesOn(trx, userId) };
    });
  }

  async function setDmMute({
    userId,
    peerUserId,
    muted
  }: {
    userId: string;
    peerUserId: string;
    muted: unknown;
  }): Promise<PreferencesResult<'not_found' | 'self' | 'muted' | 'unmuted'>> {
    type Result = PreferencesResult<'not_found' | 'self' | 'muted' | 'unmuted'>;
    if (!userId || !peerUserId) return { status: 'not_found', preferences: mapPreferences() };
    if (userId === peerUserId) return { status: 'self', preferences: mapPreferences() };

    return db.transaction().execute(async (trx): Promise<Result> => {
      if (!(await userExists(trx, userId))) {
        return { status: 'not_found', preferences: mapPreferences() };
      }
      if (!(await userExists(trx, peerUserId))) {
        return { status: 'not_found', preferences: await preferencesOn(trx, userId) };
      }
      if (muted) {
        await trx
          .insertInto('notification_dm_mutes')
          .values({ id: createRowId(), user_id: userId, peer_user_id: peerUserId, created_at: now, updated_at: now })
          .onConflict((oc) => oc.columns(['user_id', 'peer_user_id']).doUpdateSet({ updated_at: now }))
          .execute();
      } else {
        await trx
          .deleteFrom('notification_dm_mutes')
          .where('user_id', '=', userId)
          .where('peer_user_id', '=', peerUserId)
          .execute();
      }

      return { status: muted ? 'muted' : 'unmuted', preferences: await preferencesOn(trx, userId) };
    });
  }

  async function isDmMuted({ userId, peerUserId }: { userId: string; peerUserId: string }): Promise<boolean> {
    if (!userId || !peerUserId) return false;
    const row = await db
      .selectFrom('notification_dm_mutes')
      .select('id')
      .where('user_id', '=', userId)
      .where('peer_user_id', '=', peerUserId)
      .executeTakeFirst();
    return Boolean(row);
  }

  function upsertRoomLevel(q: Database, userId: string, roomId: string, level: RoomNotificationLevel) {
    return q
      .insertInto('notification_room_mutes')
      .values({ id: createRowId(), user_id: userId, room_id: roomId, level, created_at: now, updated_at: now })
      .onConflict((oc) =>
        oc.columns(['user_id', 'room_id']).doUpdateSet((eb) => ({ level: eb.ref('excluded.level'), updated_at: now }))
      )
      .execute();
  }

  // Only a room the user keeps (owns or bookmarked) can be muted.
  async function setRoomMute({
    userId,
    roomId,
    muted
  }: {
    userId: string;
    roomId: string;
    muted: unknown;
  }): Promise<PreferencesResult<'not_found' | 'temporary_room' | 'not_saved_room' | 'muted' | 'unmuted'>> {
    type Result = PreferencesResult<'not_found' | 'temporary_room' | 'not_saved_room' | 'muted' | 'unmuted'>;
    if (!userId || !roomId) return { status: 'not_found', preferences: mapPreferences() };

    return db.transaction().execute(async (trx): Promise<Result> => {
      if (!(await userExists(trx, userId))) {
        return { status: 'not_found', preferences: mapPreferences() };
      }
      const room = await trx
        .selectFrom('rooms')
        .select('is_static')
        .where('id', '=', roomId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!room) {
        return { status: 'not_found', preferences: await preferencesOn(trx, userId) };
      }
      if (!room.is_static) {
        return { status: 'temporary_room', preferences: await preferencesOn(trx, userId) };
      }
      const saved = await trx
        .selectFrom((eb) =>
          eb
            .selectFrom('room_memberships')
            .select('user_id')
            .where('room_id', '=', roomId)
            .where('role', '=', 'owner')
            .unionAll(eb.selectFrom('room_bookmarks').select('user_id').where('room_id', '=', roomId))
            .as('saved_rooms')
        )
        .select('user_id')
        .where('user_id', '=', userId)
        .limit(1)
        .executeTakeFirst();
      if (!saved) {
        return { status: 'not_saved_room', preferences: await preferencesOn(trx, userId) };
      }

      await upsertRoomLevel(trx, userId, roomId, muted ? 'none' : 'all');
      return { status: muted ? 'muted' : 'unmuted', preferences: await preferencesOn(trx, userId) };
    });
  }

  async function setRoomLevel({
    userId,
    roomId,
    level
  }: {
    userId: string;
    roomId: string;
    level: unknown;
  }): Promise<{ ok: false; code: 'invalid_level' | 'not_found' } | { ok: true; level: RoomNotificationLevel }> {
    if (!userId || !roomId || !isRoomLevel(level)) {
      return { ok: false, code: 'invalid_level' };
    }
    return db.transaction().execute(async (trx) => {
      if (!(await userExists(trx, userId))) return { ok: false as const, code: 'not_found' as const };
      const room = await trx
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', roomId)
        .where('deleted_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      if (!room) return { ok: false as const, code: 'not_found' as const };
      await upsertRoomLevel(trx, userId, roomId, level);
      return { ok: true as const, level };
    });
  }

  async function getRoomLevel({ userId, roomId }: { userId: string; roomId: string }): Promise<RoomNotificationLevel> {
    if (!userId || !roomId) return 'mentions';
    const row = await db
      .selectFrom('notification_room_mutes')
      .select('level')
      .where('user_id', '=', userId)
      .where('room_id', '=', roomId)
      .executeTakeFirst();
    return (row?.level || 'mentions') as RoomNotificationLevel;
  }

  async function isRoomMuted({ userId, roomId }: { userId: string; roomId: string }): Promise<boolean> {
    if (!userId || !roomId) return false;
    const row = await db
      .selectFrom('notification_room_mutes')
      .select('id')
      .where('user_id', '=', userId)
      .where('room_id', '=', roomId)
      .where('level', '=', 'none')
      .executeTakeFirst();
    return Boolean(row);
  }

  return {
    getPreferences,
    getRoomLevel,
    isDmMuted,
    isRoomMuted,
    setDmMute,
    setRoomMute,
    setRoomLevel,
    setDoNotDisturb,
    setPresenceStatus,
    setPrivateNotifications
  };
}

export type NotificationStore = ReturnType<typeof createNotificationStore>;

export { createNotificationStore, mapPreferences };
