// Push tokens of the Android app. A row belongs to the session the app
// registered it under, and the database deletes it with that session. A token
// is unique per provider; registering it again moves it to the caller.

import { sql } from 'kysely';
import type pg from 'pg';
import type { DevicePushProvider } from '@voice-room/shared/contracts/devices';
import type { PushLocaleIntent, PushRegistrationState } from '@voice-room/shared/contracts/push-registration';
import { resolveLocale, type AppLocale } from '@voice-room/shared/localization';
import { lockKeys, lockXact } from '../../platform/db/locks.ts';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { createRowId } from '../../platform/db/ids.ts';

/** Where a push to one phone goes, and the app version that registered it. */
export type DeviceTokenTarget = {
  provider: string;
  token: string;
  appVersion: string | null;
  notificationChannels?: readonly string[];
  locale?: AppLocale;
};

function createDeviceTokenRepository({ pool, maxTokensPerUser = 10 }: { pool: pg.Pool; maxTokensPerUser?: number }) {
  const db = kyselyOn(pool);
  const tokenLimit = Math.max(1, Math.floor(Number(maxTokensPerUser) || 10));

  async function register({
    userId,
    sessionId,
    provider,
    token,
    appVersion,
    notificationChannels = [],
    localeState
  }: {
    userId: string;
    sessionId: string;
    provider: DevicePushProvider;
    token: string;
    appVersion: string | null;
    notificationChannels?: readonly string[];
    localeState?: PushLocaleIntent;
  }): Promise<
    | { status: 'registered'; registration: PushRegistrationState }
    | { status: 'locale_conflict'; registration: PushRegistrationState | null }
    | { status: 'invalid_session' }
  > {
    return db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const session = await trx
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', sessionId)
        .where('user_id', '=', userId)
        .where('expires_at', '>', new Date())
        .forKeyShare()
        .executeTakeFirst();
      if (!session) return { status: 'invalid_session' };
      await lockXact(trx, lockKeys.pushTarget(provider, token));
      const current = await trx
        .selectFrom('device_tokens')
        .selectAll()
        .where('provider', '=', provider)
        .where('token', '=', token)
        .forUpdate()
        .executeTakeFirst();
      const state: PushRegistrationState | null = current
        ? { protocol: 1, locale: resolveLocale([], current.locale), version: current.registration_version }
        : null;
      if (
        localeState &&
        localeState.expectedVersion !== state?.version &&
        !(localeState.expectedVersion === null && !state)
      ) {
        return { status: 'locale_conflict', registration: state };
      }
      const locale = localeState?.locale ?? state?.locale ?? 'ru';
      const changed =
        !current ||
        current.user_id !== userId ||
        current.session_id !== sessionId ||
        current.app_version !== appVersion ||
        current.locale !== locale ||
        JSON.stringify(current.notification_channels) !== JSON.stringify(notificationChannels);
      const version = changed ? createRowId() : (state?.version ?? createRowId());
      const values = {
        user_id: userId,
        session_id: sessionId,
        app_version: appVersion,
        notification_channels: [...notificationChannels],
        locale,
        registration_version: version,
        last_seen_at: sql<Date>`current_timestamp`
      };
      if (current) await trx.updateTable('device_tokens').set(values).where('id', '=', current.id).execute();
      else
        await trx
          .insertInto('device_tokens')
          .values({ id: createRowId(), provider, token, ...values })
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
      return { status: 'registered', registration: { protocol: 1, locale, version } };
    });
  }

  async function upsert(input: Parameters<typeof register>[0]): Promise<void> {
    await register(input);
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
      .select([
        'device_tokens.provider',
        'device_tokens.token',
        'device_tokens.app_version',
        'device_tokens.notification_channels',
        'device_tokens.locale'
      ])
      .where('device_tokens.user_id', '=', userId)
      .where('sessions.expires_at', '>', new Date(now))
      .orderBy('device_tokens.last_seen_at', 'desc')
      .orderBy('device_tokens.id', 'desc')
      .execute();
    return rows.map((row) => ({
      provider: row.provider,
      token: row.token,
      appVersion: row.app_version,
      notificationChannels: row.notification_channels,
      locale: resolveLocale([], row.locale)
    }));
  }

  return { listByUserId, remove, removeToken, upsert, register };
}

export type DeviceTokenRepository = ReturnType<typeof createDeviceTokenRepository>;

export { createDeviceTokenRepository };
