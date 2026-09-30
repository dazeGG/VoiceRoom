// Sign-in history: every sign-in is recorded, and one from an unfamiliar
// device raises an alert until the account resolves it.

import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import {
  LOGIN_ALERT_TTL_MS,
  LOGIN_FAMILIARITY_WINDOW_MS,
  describeUserAgent
} from '@voice-room/shared/account-security';
import { LOGIN_EVENT_RETENTION_MS, UUID_PATTERN, cleanLocationLabel, mapLoginAlert, toDate } from './user-records.ts';

export function createLoginEventRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  // A sign-in needs the account's attention when it comes from a device (browser
  // and system) and city the account has not used in the familiarity window.
  // Only answered or unflagged sign-ins vouch for a device: an unanswered
  // question must not let the same stranger sign in again quietly. The first
  // sign-in an account records with nothing else open just sets the baseline.
  async function recordLogin({
    userId,
    sessionPublicId = null,
    kind = 'login',
    userAgent = '',
    locationLabel = '',
    now = Date.now()
  }: {
    userId: string;
    sessionPublicId?: string | null;
    kind?: string;
    userAgent?: string;
    locationLabel?: unknown;
    now?: number;
  }) {
    const device = describeUserAgent(userAgent);
    const location = cleanLocationLabel(locationLabel);
    const sameDevice = (entry: { client: unknown; os: unknown; location: unknown }) =>
      entry.client === device.client && entry.os === device.os && entry.location === location;
    return db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:login-events:${userId}`}))`.execute(trx);
      let alert = false;
      if (kind !== 'register') {
        const history = await trx
          .selectFrom('account_login_events')
          .select(['client', 'os', 'location_label', 'alert', 'resolution', 'created_at'])
          .where('user_id', '=', userId)
          .where('created_at', '>', toDate(now - LOGIN_FAMILIARITY_WINDOW_MS))
          .execute();
        const sessions = await trx
          .selectFrom('sessions as s')
          .leftJoin('account_login_events as e', 'e.session_public_id', 's.public_id')
          .select(['s.user_agent', 's.location_label'])
          .where('s.user_id', '=', userId)
          .where('s.expires_at', '>', toDate(now))
          .where(sql<boolean>`s.public_id IS DISTINCT FROM ${sessionPublicId}::uuid`)
          .where(sql<boolean>`NOT (COALESCE(e.alert, false) AND (e.resolution IS NULL OR e.resolution = 'denied'))`)
          .execute();
        const vouchedByHistory = history.some(
          (row) =>
            (!row.alert || row.resolution === 'confirmed') &&
            sameDevice({ client: row.client, os: row.os, location: row.location_label })
        );
        const vouchedBySession = sessions.some((row) =>
          sameDevice({ ...describeUserAgent(row.user_agent), location: row.location_label || '' })
        );
        // Only an account that never signed in sets a baseline. Judging by the
        // window alone would let any sign-in after a month away pass quietly.
        const signedInBefore =
          history.length > 0 ||
          Boolean(
            await trx
              .selectFrom('account_login_events')
              .select('id')
              .where('user_id', '=', userId)
              .limit(1)
              .executeTakeFirst()
          );
        const baseline = !signedInBefore && sessions.length === 0;
        alert = !baseline && !vouchedByHistory && !vouchedBySession;
      }
      const inserted = await trx
        .insertInto('account_login_events')
        .values({
          user_id: userId,
          session_public_id: sessionPublicId,
          kind,
          client: device.client,
          os: device.os,
          location_label: location,
          alert,
          created_at: toDate(now)
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { alert: alert ? mapLoginAlert(inserted) : null };
    });
  }

  // Unanswered questions about sign-ins, except the one this very session made.
  async function listPendingLoginAlerts({
    userId,
    excludeSessionPublicId = null,
    now = Date.now()
  }: {
    userId: string;
    excludeSessionPublicId?: string | null;
    now?: number;
  }) {
    const rows = await db
      .selectFrom('account_login_events')
      .selectAll()
      .where('user_id', '=', userId)
      .where('alert', '=', true)
      .where('resolved_at', 'is', null)
      .where('created_at', '>', toDate(now - LOGIN_ALERT_TTL_MS))
      .where(sql<boolean>`session_public_id IS DISTINCT FROM ${excludeSessionPublicId}::uuid`)
      .orderBy('created_at', 'asc')
      .limit(20)
      .execute();
    return rows.map(mapLoginAlert);
  }

  // "Это не я" ends the session that sign-in opened in the same transaction and
  // hands back its token hash so its sockets and voice can be closed too.
  async function resolveLoginAlert({
    userId,
    alertId,
    resolution,
    currentSessionPublicId = null,
    now = Date.now()
  }: {
    userId: string;
    alertId: unknown;
    resolution: unknown;
    currentSessionPublicId?: string | null;
    now?: number;
  }) {
    if (typeof alertId !== 'string' || !UUID_PATTERN.test(alertId)) {
      return { status: 'not_found', revokedTokenHash: null };
    }
    if (resolution !== 'confirmed' && resolution !== 'denied') {
      return { status: 'not_found', revokedTokenHash: null };
    }
    return db.transaction().execute(async (trx) => {
      const resolved = await trx
        .updateTable('account_login_events')
        .set({ resolved_at: toDate(now), resolution })
        .where('id', '=', alertId.toLowerCase())
        .where('user_id', '=', userId)
        .where('alert', '=', true)
        .where('resolved_at', 'is', null)
        .where('created_at', '>', toDate(now - LOGIN_ALERT_TTL_MS))
        .where(sql<boolean>`session_public_id IS DISTINCT FROM ${currentSessionPublicId}::uuid`)
        .returning('session_public_id')
        .execute();
      if (resolved.length !== 1) return { status: 'not_found', revokedTokenHash: null };
      const sessionPublicId = resolved[0]?.session_public_id;
      if (resolution !== 'denied' || !sessionPublicId) return { status: 'resolved', revokedTokenHash: null };
      const deleted = await trx
        .deleteFrom('sessions')
        .where('user_id', '=', userId)
        .where('public_id', '=', sessionPublicId)
        .returning('id')
        .executeTakeFirst();
      return { status: 'resolved', revokedTokenHash: deleted?.id || null };
    });
  }

  async function pruneLoginEvents(now: number = Date.now()) {
    const result = await db
      .deleteFrom('account_login_events')
      .where('created_at', '<=', toDate(now - LOGIN_EVENT_RETENTION_MS))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  return {
    recordLogin,
    listPendingLoginAlerts,
    resolveLoginAlert,
    pruneLoginEvents
  };
}
