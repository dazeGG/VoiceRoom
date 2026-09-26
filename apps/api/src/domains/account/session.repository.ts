// Sessions: issuing a session token, resolving it on each request (and
// touching it at most hourly), listing and revoking an account's sessions.

import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createLogger } from '../../lib/logger.ts';
import { describeUserAgent, isDesktopAppUserAgent } from '@voice-room/shared/account-security';
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  UUID_PATTERN,
  type UserStoreLogger,
  cleanLocationLabel,
  cleanUserAgent,
  createSessionToken,
  desktopAppSeen,
  hasMetadataKey,
  hashSessionToken,
  mapUser,
  toDate,
  toMillis
} from './user-records.ts';

export function createSessionRepository({
  pool,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  logger = createLogger({ name: 'api' })
}: {
  pool: pg.Pool;
  sessionTtlMs?: number;
  logger?: UserStoreLogger;
}) {
  const db = kyselyOn(pool);

  async function createSession({
    userId,
    now = Date.now(),
    token = createSessionToken(),
    userAgent = '',
    locationLabel = ''
  }: {
    userId: string;
    now?: number;
    token?: string;
    userAgent?: string;
    locationLabel?: unknown;
  }) {
    const expiresAt = now + sessionTtlMs;
    const tokenHash = hashSessionToken(token);
    const row = await db
      .insertInto('sessions')
      .values({
        id: tokenHash,
        user_id: userId,
        created_at: toDate(now),
        last_seen_at: toDate(now),
        expires_at: toDate(expiresAt),
        user_agent: cleanUserAgent(userAgent),
        location_label: cleanLocationLabel(locationLabel)
      })
      .returning('public_id')
      .executeTakeFirstOrThrow();
    if (isDesktopAppUserAgent(userAgent)) {
      await db
        .updateTable('users')
        .set({ metadata: desktopAppSeen(now) })
        .where('id', '=', userId)
        .where((eb) => eb.not(hasMetadataKey('desktopAppSeenAt')))
        .execute();
    }
    return { expiresAt, publicId: row.public_id, token, tokenHash };
  }

  // `userAgent` and `resolveLocation` only feed the hourly touch, so a request
  // never waits on a location lookup and an unchanged session is not rewritten.
  async function getSessionUser(
    token: unknown,
    now: number = Date.now(),
    { userAgent, resolveLocation }: { userAgent?: string; resolveLocation?: () => unknown } = {}
  ) {
    if (typeof token !== 'string' || !token) return null;
    const tokenHash = hashSessionToken(token);
    const row = await db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .selectAll('u')
      .select([
        's.expires_at as session_expires_at',
        's.last_seen_at as session_last_seen_at',
        's.public_id as session_public_id'
      ])
      .where('s.id', '=', tokenHash)
      .where('s.expires_at', '>', toDate(now))
      .executeTakeFirst();
    if (!row) return null;

    if (toMillis(row.session_last_seen_at) <= now - SESSION_TOUCH_INTERVAL_MS) {
      void touchSession({ tokenHash, now, userAgent, resolveLocation }).catch((error: unknown) =>
        logger.warn({ evt: LOG_EVENTS.SESSION_TOUCH_FAILED, err: error }, 'failed to touch a session')
      );
    }

    return {
      session: {
        expiresAt: toMillis(row.session_expires_at),
        publicId: row.session_public_id,
        token,
        tokenHash
      },
      user: mapUser(row)
    };
  }

  // Best-effort sliding touch: extends the server-side TTL and refreshes what
  // the devices list shows. An empty location keeps the previous label, so a
  // missing GeoIP database does not erase what an earlier lookup found.
  async function touchSession({
    tokenHash,
    now,
    userAgent,
    resolveLocation
  }: {
    tokenHash: string;
    now: number;
    userAgent?: string;
    resolveLocation?: () => unknown;
  }): Promise<void> {
    let locationLabel = '';
    if (typeof resolveLocation === 'function') {
      try {
        locationLabel = cleanLocationLabel(await resolveLocation());
      } catch (error) {
        logger.warn(
          { evt: LOG_EVENTS.GEOIP_UNAVAILABLE, reason: 'lookup_failed', err: error },
          'failed to resolve a session location'
        );
      }
    }
    const agent = cleanUserAgent(userAgent);
    await db
      .updateTable('sessions')
      .set((eb) => ({
        last_seen_at: toDate(now),
        expires_at: sql<Date>`GREATEST(expires_at, ${toDate(now + sessionTtlMs)})`,
        user_agent: agent ? agent : eb.ref('user_agent'),
        location_label: locationLabel ? locationLabel : eb.ref('location_label')
      }))
      .where('id', '=', tokenHash)
      .where('last_seen_at', '<=', toDate(now - SESSION_TOUCH_INTERVAL_MS))
      .execute();
    // A session that predates the marker (or a desktop login made while an
    // older release was live) is stamped on its next hourly touch. The guard
    // keeps the users row from being rewritten on every later touch.
    if (isDesktopAppUserAgent(userAgent)) {
      await db
        .updateTable('users as u')
        .from('sessions as s')
        .set({
          metadata: sql`jsonb_set(u.metadata, '{desktopAppSeenAt}', to_jsonb(${Math.trunc(Number(now) || Date.now())}::bigint), true)`
        })
        .where('s.id', '=', tokenHash)
        .whereRef('u.id', '=', 's.user_id')
        .where((eb) => eb.not(sql<boolean>`u.metadata ? 'desktopAppSeenAt'`))
        .execute();
    }
  }

  async function deleteSession(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !token) return false;
    const result = await db.deleteFrom('sessions').where('id', '=', hashSessionToken(token)).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async function pruneSessions(now: number = Date.now()) {
    const result = await db.deleteFrom('sessions').where('expires_at', '<=', toDate(now)).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async function listSessions({
    userId,
    currentTokenHash = '',
    now = Date.now()
  }: {
    userId: string;
    currentTokenHash?: string;
    now?: number;
  }) {
    const rows = await db
      .selectFrom('sessions')
      .select(['id', 'public_id', 'user_agent', 'location_label', 'last_seen_at'])
      .where('user_id', '=', userId)
      .where('expires_at', '>', toDate(now))
      .orderBy('last_seen_at', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.public_id,
      current: Boolean(currentTokenHash) && row.id === currentTokenHash,
      ...describeUserAgent(row.user_agent),
      location: row.location_label || '',
      lastSeenAt: toMillis(row.last_seen_at)
    }));
  }

  // Returns the token hash so the caller can close whatever that session still
  // holds open (sockets, voice); the hash itself never reaches a client.
  async function revokeSession({ userId, publicId }: { userId: string; publicId: unknown }) {
    if (typeof publicId !== 'string' || !UUID_PATTERN.test(publicId)) return { status: 'not_found', tokenHash: null };
    const rows = await db
      .deleteFrom('sessions')
      .where('user_id', '=', userId)
      .where('public_id', '=', publicId.toLowerCase())
      .returning('id')
      .execute();
    return rows.length === 1 && rows[0]
      ? { status: 'revoked', tokenHash: rows[0].id }
      : { status: 'not_found', tokenHash: null };
  }

  async function revokeOtherSessions({
    userId,
    keepTokenHash
  }: {
    userId: string;
    keepTokenHash: unknown;
  }): Promise<{ tokenHashes: string[] }> {
    const rows = await db
      .deleteFrom('sessions')
      .where('user_id', '=', userId)
      .where('id', '<>', typeof keepTokenHash === 'string' ? keepTokenHash : '')
      .returning('id')
      .execute();
    return { tokenHashes: rows.map((row) => row.id) };
  }

  return {
    createSession,
    getSessionUser,
    touchSession,
    deleteSession,
    pruneSessions,
    listSessions,
    revokeSession,
    revokeOtherSessions
  };
}
