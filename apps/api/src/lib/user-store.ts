import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import type { AccountLoginEvents, Json, Users } from '../platform/db/schema.ts';
import { kyselyOn, type Database } from '../platform/db/kysely.ts';
import type { SelfUser as SelfProfile } from '@voice-room/shared/contracts/account';
import type { PublicUser as PublicProfile } from '@voice-room/shared/contracts/users';
import { hashPassword, verifyPassword } from './password.ts';
import { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus } from '@voice-room/shared/validation';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';
import {
  LOGIN_ALERT_TTL_MS,
  LOGIN_FAMILIARITY_WINDOW_MS,
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  WHATS_NEW_VERSION,
  describeUserAgent,
  isDesktopAppUserAgent,
  normalizeRecoveryCode,
  normalizeReleaseVersion
} from '@voice-room/shared/account-security';

type UserStoreLogger = { warn(...args: unknown[]): void };
export type StoredUser = NonNullable<ReturnType<typeof mapUser>>;
export type PublicUser = PublicProfile;

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const USER_AGENT_MAX_LENGTH = 512;
const LOCATION_LABEL_MAX_LENGTH = 120;
const UNIQUE_VIOLATION = '23505';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Longer than the familiarity window, so a device keeps vouching for itself
// for the whole window after its last sign-in.
const LOGIN_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function toDate(ms: unknown): Date {
  const next = Number(ms);
  return new Date(Number.isFinite(next) && next >= 0 ? next : Date.now());
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

// Per-account markers kept in `users.metadata` as epoch milliseconds.
function metadataMillis(metadata: unknown, key: string): number | null {
  const value = Number(metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>)[key] : NaN);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function randomAvatarColorKey(): string {
  return AVATAR_COLOR_KEYS[crypto.randomInt(AVATAR_COLOR_KEYS.length)] as string;
}

function mapUser(row: Selectable<Users> | null | undefined) {
  if (!row) return null;
  const presenceStatus = cleanPresenceStatus(row.presence_status) || (row.dnd ? 'dnd' : 'online');
  return {
    avatarAccent: row.avatar_accent || null,
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    avatarKey: row.avatar_key || null,
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    doNotDisturb: presenceStatus === 'dnd',
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash,
    presenceStatus,
    deletionRequestedAt: row.deletion_requested_at ? toMillis(row.deletion_requested_at) : null,
    deletedAt: row.deleted_at ? toMillis(row.deleted_at) : null,
    desktopAppSeenAt: metadataMillis(row.metadata, 'desktopAppSeenAt'),
    appPromptSeenAt: metadataMillis(row.metadata, 'appPromptSeenAt')
  };
}

/** Enough of an account to show it: the id and login, and whatever else is known. */
export type ProfileSource = Pick<StoredUser, 'id' | 'login'> & Partial<StoredUser>;

// What we ever send back to a client: never the password hash.
function publicUser(user: ProfileSource): PublicProfile;
function publicUser(user: ProfileSource | null | undefined): PublicProfile | null;
function publicUser(user: ProfileSource | null | undefined): PublicProfile | null {
  if (!user) return null;
  const presenceStatus = cleanPresenceStatus(user.presenceStatus) || (user.doNotDisturb ? 'dnd' : 'online');
  return {
    avatarAccent: user.avatarAccent || null,
    createdAt: user.createdAt ?? null,
    avatarColorKey: user.avatarColorKey || 'blurple',
    avatarUrl: user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null,
    displayName: user.displayName || '',
    dnd: presenceStatus === 'dnd',
    doNotDisturb: presenceStatus === 'dnd',
    id: user.id,
    login: user.login,
    presenceStatus
  };
}

// The signed-in account's own view: the public shape plus facts that must never
// reach other users (DM peers, profile broadcasts, message authors).
function selfUser(user: ProfileSource): SelfProfile;
function selfUser(user: ProfileSource | null | undefined): SelfProfile | null;
function selfUser(user: ProfileSource | null | undefined): SelfProfile | null {
  const base = publicUser(user);
  if (!base || !user) return null;
  return {
    ...base,
    hasUsedDesktopApp: Boolean(user.desktopAppSeenAt),
    appPromptSeen: Boolean(user.appPromptSeenAt)
  };
}

function createSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token: unknown): string {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

function createRecoveryCode(): string {
  let code = '';
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
  }
  return code;
}

// Bound to the account so the same code on two accounts never shares a hash.
function hashRecoveryCode(userId: string, code: string): string {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function cleanUserAgent(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, USER_AGENT_MAX_LENGTH) : '';
}

function cleanLocationLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, LOCATION_LABEL_MAX_LENGTH) : '';
}

// What a device is shown by; the session it opened stays server-side. Only
// sign-ins and recoveries raise alerts; a registration never does.
function mapLoginAlert(row: Selectable<AccountLoginEvents>) {
  return {
    id: row.id,
    kind: row.kind === 'recovery' ? ('recovery' as const) : ('login' as const),
    client: row.client || '',
    os: row.os || '',
    location: row.location_label || '',
    createdAt: toMillis(row.created_at)
  };
}

function createUserStore({
  logger = createLogger({ name: 'api' }),
  pool,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS
}: {
  logger?: UserStoreLogger;
  pool: pg.Pool;
  sessionTtlMs?: number;
}) {
  const db = kyselyOn(pool);

  async function createUser({
    login,
    avatarColorKey = '',
    displayName = '',
    password,
    now = Date.now()
  }: {
    login: string;
    avatarColorKey?: string;
    displayName?: string;
    password: string;
    now?: number;
  }) {
    if (!login) throw new Error('Login is required');
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    const assignedAvatarColorKey = cleanAvatarColorKey(avatarColorKey) || randomAvatarColorKey();

    try {
      // "What's new" is for people who used an earlier release; a new account
      // starts at the current announcement.
      const row = await db
        .insertInto('users')
        .values({
          id,
          login,
          display_name: displayName,
          password_hash: passwordHash,
          avatar_color_key: assignedAvatarColorKey,
          created_at: toDate(now),
          updated_at: toDate(now),
          metadata: sql`jsonb_build_object('whatsNewSeen', ${WHATS_NEW_VERSION}::text)`
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { status: 'created', user: mapUser(row)! };
    } catch (error) {
      if (error && (error as { code?: unknown }).code === UNIQUE_VIOLATION) {
        return { status: 'login_taken', user: null };
      }
      throw error;
    }
  }

  async function getUserByLogin(login: string) {
    return mapUser(await db.selectFrom('users').selectAll().where('login', '=', login).executeTakeFirst());
  }

  async function getUserById(id: string) {
    return mapUser(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst());
  }

  // Rename: the display name is the only mutable identity field. An empty value
  // is allowed (the room then falls back to the login). Returns the updated
  // public-shaped user, or null when the account no longer exists.
  async function updateDisplayName({
    userId,
    displayName = '',
    now = Date.now()
  }: {
    userId: string;
    displayName?: string;
    now?: number;
  }) {
    const row = await db
      .updateTable('users')
      .set({ display_name: displayName, updated_at: toDate(now) })
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirst();
    return mapUser(row);
  }

  function setAvatar(q: Database, userId: string, avatarKey: string | null, avatarAccent: string | null, now: number) {
    return q
      .updateTable('users')
      .set({ avatar_key: avatarKey || null, avatar_accent: avatarAccent || null, updated_at: toDate(now) })
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirst();
  }

  async function updateAvatar({
    userId,
    avatarKey = null,
    avatarAccent = null,
    now = Date.now()
  }: {
    userId: string;
    avatarKey?: string | null;
    avatarAccent?: string | null;
    now?: number;
  }) {
    return mapUser(await setAvatar(db, userId, avatarKey, avatarAccent, now));
  }

  async function swapAvatar({
    userId,
    avatarKey = null,
    avatarAccent = null,
    now = Date.now()
  }: {
    userId: string;
    avatarKey?: string | null;
    avatarAccent?: string | null;
    now?: number;
  }) {
    return db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('users')
        .select('avatar_key')
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { previousAvatarKey: null, user: null };
      const row = await setAvatar(trx, userId, avatarKey, avatarAccent, now);
      return { previousAvatarKey: current.avatar_key || null, user: mapUser(row) };
    });
  }

  async function listAvatarKeys(): Promise<string[]> {
    // An account waiting to be deleted keeps its avatar aside for a restore, so
    // avatar reconciliation must not treat that file as unused.
    const keptForRestore = sql<string | null>`metadata->'deletedProfile'->>'avatarKey'`;
    const rows = await db
      .selectFrom('users')
      .select('avatar_key')
      .where('avatar_key', 'is not', null)
      .union(db.selectFrom('users').select(keptForRestore.as('avatar_key')).where(keptForRestore, 'is not', null))
      .execute();
    return rows.map((row) => row.avatar_key).filter((key): key is string => Boolean(key));
  }

  // Every way of replacing a password ends the same: the old credential stops
  // working everywhere, so all sessions and push subscriptions go with it.
  async function replacePassword(
    trx: Database,
    { userId, newPassword, now }: { userId: string; newPassword: string; now: number }
  ): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    await trx
      .updateTable('users')
      .set({ password_hash: passwordHash, updated_at: toDate(now) })
      .where('id', '=', userId)
      .execute();
    await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
    await trx.deleteFrom('push_subscriptions').where('user_id', '=', userId).execute();
  }

  function lockUser(trx: Database, column: 'id' | 'login', value: string) {
    return trx.selectFrom('users').selectAll().where(column, '=', value).forUpdate().executeTakeFirst();
  }

  // Password change always re-verifies the current password first so a leaked
  // session alone can't rotate the credential. Status mirrors the createUser
  // shape so the route layer can branch without inspecting errors.
  async function changePassword({
    userId,
    currentPassword,
    newPassword,
    now = Date.now()
  }: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    now?: number;
  }) {
    return db.transaction().execute(async (trx) => {
      const user = mapUser(await lockUser(trx, 'id', userId));
      if (!user) return { status: 'not_found' };

      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) return { status: 'invalid_password' };

      await replacePassword(trx, { userId, newPassword, now });
      return { status: 'updated' };
    });
  }

  async function verifyCredentials(login: string, password: string) {
    const user = await getUserByLogin(login);
    if (!user) {
      // Spend a comparable amount of time so a missing login isn't observably
      // faster than a wrong password.
      await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==');
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }

  // The first sign-in from the desktop app is remembered on the account.
  const desktopAppSeen = (now: number) =>
    sql<Json>`jsonb_set(metadata, '{desktopAppSeenAt}', to_jsonb(${Math.trunc(Number(now) || Date.now())}::bigint), true)`;
  const hasMetadataKey = (key: string) => sql<boolean>`metadata ? ${key}`;

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

  // Generating a set proves the password again, like a password change, so a
  // stolen session cannot mint itself a permanent way back into the account.
  async function generateRecoveryCodes({
    userId,
    currentPassword,
    now = Date.now()
  }: {
    userId: string;
    currentPassword: string;
    now?: number;
  }) {
    return db.transaction().execute(async (trx) => {
      const user = mapUser(await lockUser(trx, 'id', userId));
      if (!user) return { status: 'not_found', codes: [] };
      if (!(await verifyPassword(currentPassword, user.passwordHash))) return { status: 'invalid_password', codes: [] };

      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
      await trx.deleteFrom('account_recovery_codes').where('user_id', '=', userId).execute();
      await trx
        .insertInto('account_recovery_codes')
        .values(
          codes.map((code) => ({ user_id: userId, code_hash: hashRecoveryCode(userId, code), created_at: toDate(now) }))
        )
        .execute();
      return { status: 'generated', codes, generatedAt: now };
    });
  }

  async function getRecoveryCodesStatus(userId: string) {
    const row = await db
      .selectFrom('account_recovery_codes')
      .select([
        sql<number>`count(*) FILTER (WHERE used_at IS NULL)::int`.as('remaining'),
        (eb) => eb.fn.max('created_at').as('generated_at')
      ])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return {
      remaining: Number(row?.remaining) || 0,
      generatedAt: row?.generated_at ? toMillis(row.generated_at) : null
    };
  }

  // Both failure paths (unknown login, wrong or spent code) return before the
  // password hash is computed, so neither is observably slower than the other.
  async function recoverWithCode({
    login,
    code,
    newPassword,
    now = Date.now()
  }: {
    login: string;
    code: unknown;
    newPassword: string;
    now?: number;
  }) {
    const normalizedCode = normalizeRecoveryCode(code);
    if (!login || !normalizedCode) return { status: 'invalid', user: null, remaining: 0 };
    return db.transaction().execute(async (trx) => {
      const user = mapUser(await lockUser(trx, 'login', login));
      // An account waiting to be deleted comes back through a restore, not a code.
      if (!user || user.deletionRequestedAt || user.deletedAt) return { status: 'invalid', user: null, remaining: 0 };

      const spent = await trx
        .updateTable('account_recovery_codes')
        .set({ used_at: toDate(now) })
        .where('user_id', '=', user.id)
        .where('code_hash', '=', hashRecoveryCode(user.id, normalizedCode))
        .where('used_at', 'is', null)
        .returning('id')
        .execute();
      if (spent.length !== 1) return { status: 'invalid', user: null, remaining: 0 };

      await replacePassword(trx, { userId: user.id, newPassword, now });
      const remaining = await trx
        .selectFrom('account_recovery_codes')
        .select(sql<number>`count(*)::int`.as('remaining'))
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .executeTakeFirst();
      return { status: 'recovered', user, remaining: Number(remaining?.remaining) || 0 };
    });
  }

  // Per-account state of the nudges the lobby shows: the last "what's new"
  // announcement seen and how long the recovery codes reminder stays hidden.
  async function getAccountNotices(userId: string) {
    const row = await db
      .selectFrom('users')
      .select([
        sql<string | null>`metadata->>'whatsNewSeen'`.as('whats_new_seen'),
        sql<unknown>`metadata->'recoveryCodesReminderSnoozedUntil'`.as('reminder_snoozed_until')
      ])
      .where('id', '=', userId)
      .executeTakeFirst();
    const snoozedUntil = Number(row?.reminder_snoozed_until);
    return {
      whatsNewSeen: normalizeReleaseVersion(row?.whats_new_seen) || null,
      recoveryCodesReminderSnoozedUntil: Number.isSafeInteger(snoozedUntil) && snoozedUntil > 0 ? snoozedUntil : null
    };
  }

  // Only the current announcement can be recorded, so a stale client cannot
  // pin an account to an older release.
  async function markWhatsNewSeen({ userId, now = Date.now() }: { userId: string; now?: number }) {
    const result = await db
      .updateTable('users')
      .set({
        metadata: sql`jsonb_set(metadata, '{whatsNewSeen}', to_jsonb(${WHATS_NEW_VERSION}::text), true)`,
        updated_at: toDate(now)
      })
      .where('id', '=', userId)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n
      ? { status: 'seen', whatsNewSeen: WHATS_NEW_VERSION }
      : { status: 'not_found', whatsNewSeen: null };
  }

  // The one-time post-registration app prompt: the first time it is shown or
  // dismissed wins, so repeated calls from several tabs keep that moment.
  async function markAppPromptSeen({ userId, now = Date.now() }: { userId: string; now?: number }) {
    const seenAtMs = Math.trunc(Number(now) || Date.now());
    const rows = await db
      .updateTable('users')
      .set({
        metadata: sql`CASE
          WHEN metadata ? 'appPromptSeenAt' THEN metadata
          ELSE jsonb_set(metadata, '{appPromptSeenAt}', to_jsonb(${seenAtMs}::bigint), true)
        END`
      })
      .where('id', '=', userId)
      .returning(sql<unknown>`metadata->'appPromptSeenAt'`.as('seen_at'))
      .execute();
    const seenAt = Number(rows[0]?.seen_at);
    return rows.length === 1
      ? { status: 'seen', appPromptSeenAt: Number.isSafeInteger(seenAt) ? seenAt : null }
      : { status: 'not_found', appPromptSeenAt: null };
  }

  async function snoozeRecoveryCodesReminder({ userId, now = Date.now() }: { userId: string; now?: number }) {
    const snoozedUntil = now + RECOVERY_CODES_REMINDER_SNOOZE_MS;
    const result = await db
      .updateTable('users')
      .set({
        metadata: sql`jsonb_set(metadata, '{recoveryCodesReminderSnoozedUntil}', to_jsonb(${snoozedUntil}::bigint), true)`,
        updated_at: toDate(now)
      })
      .where('id', '=', userId)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n
      ? { status: 'snoozed', snoozedUntil }
      : { status: 'not_found', snoozedUntil: null };
  }

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
    changePassword,
    createSession,
    createUser,
    deleteSession,
    generateRecoveryCodes,
    getAccountNotices,
    getRecoveryCodesStatus,
    getSessionUser,
    getUserById,
    getUserByLogin,
    listAvatarKeys,
    listPendingLoginAlerts,
    listSessions,
    markAppPromptSeen,
    markWhatsNewSeen,
    pruneLoginEvents,
    pruneSessions,
    recordLogin,
    recoverWithCode,
    resolveLoginAlert,
    revokeOtherSessions,
    revokeSession,
    snoozeRecoveryCodesReminder,
    swapAvatar,
    updateAvatar,
    updateDisplayName,
    verifyCredentials
  };
}

export type UserStore = ReturnType<typeof createUserStore>;

export { createUserStore, hashRecoveryCode, hashSessionToken, mapUser, publicUser, randomAvatarColorKey, selfUser };
