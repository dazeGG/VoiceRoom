// Push tokens of the Android app. A row belongs to the session the app
// registered it under, and the database deletes it with that session. A token
// is unique per provider; registering it again moves it to the caller.

import { sql } from 'kysely';
import type pg from 'pg';
import type { DevicePushProvider } from '@voice-room/shared/contracts/devices';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { createRowId } from '../../platform/db/ids.ts';

/** Where a push to one phone goes, and the app version that registered it. */
export type DeviceTokenTarget = { provider: string; token: string; appVersion: string | null };

function createDeviceTokenRepository({ pool, maxTokensPerUser = 10 }: { pool: pg.Pool; maxTokensPerUser?: number }) {
  const db = kyselyOn(pool);
  const tokenLimit = Math.max(1, Math.floor(Number(maxTokensPerUser) || 10));

  // Each account keeps its most recently seen tokens up to the limit; the one
  // just registered always stays.
  async function upsert({
    userId,
    sessionId,
    provider,
    token,
    appVersion
  }: {
    userId: string;
    sessionId: string;
    provider: DevicePushProvider;
    token: string;
    appVersion: string | null;
  }): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      await trx
        .insertInto('device_tokens')
        .values({
          id: createRowId(),
          user_id: userId,
          session_id: sessionId,
          provider,
          token,
          app_version: appVersion
        })
        .onConflict((oc) =>
          oc.columns(['provider', 'token']).doUpdateSet((eb) => ({
            user_id: eb.ref('excluded.user_id'),
            session_id: eb.ref('excluded.session_id'),
            app_version: eb.ref('excluded.app_version'),
            last_seen_at: sql<Date>`current_timestamp`
          }))
        )
        .execute();
      await trx
        .deleteFrom('device_tokens')
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('device_tokens')
            .select('id')
            .where('user_id', '=', userId)
            .orderBy(sql`CASE WHEN provider = ${provider} AND token = ${token} THEN 0 ELSE 1 END`)
            .orderBy('last_seen_at', 'desc')
            .orderBy('id', 'desc')
            .offset(tokenLimit)
        )
        .execute();
    });
  }

  /** Removes the caller's own token; false when the caller had no such token. */
  async function remove({
    userId,
    provider,
    token
  }: {
    userId: string;
    provider: DevicePushProvider;
    token: string;
  }): Promise<boolean> {
    const result = await db
      .deleteFrom('device_tokens')
      .where('user_id', '=', userId)
      .where('provider', '=', provider)
      .where('token', '=', token)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /** Forgets a token the push service no longer knows, whoever registered it. */
  async function removeToken({ provider, token }: { provider: string; token: string }): Promise<void> {
    await db.deleteFrom('device_tokens').where('provider', '=', provider).where('token', '=', token).execute();
  }

  /** The account's tokens whose session is still live at `now`, most recently seen first. */
  async function listByUserId(userId: string, now: number = Date.now()): Promise<DeviceTokenTarget[]> {
    const rows = await db
      .selectFrom('device_tokens')
      .innerJoin('sessions', 'sessions.id', 'device_tokens.session_id')
      .select(['device_tokens.provider', 'device_tokens.token', 'device_tokens.app_version'])
      .where('device_tokens.user_id', '=', userId)
      .where('sessions.expires_at', '>', new Date(now))
      .orderBy('device_tokens.last_seen_at', 'desc')
      .orderBy('device_tokens.id', 'desc')
      .execute();
    return rows.map((row) => ({ provider: row.provider, token: row.token, appVersion: row.app_version }));
  }

  return { listByUserId, remove, removeToken, upsert };
}

export type DeviceTokenRepository = ReturnType<typeof createDeviceTokenRepository>;

export { createDeviceTokenRepository };
