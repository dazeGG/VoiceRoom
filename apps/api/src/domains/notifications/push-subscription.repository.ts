import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { isOneOf, isRecord } from '@voice-room/shared/guards';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { createRowId } from '../../platform/db/ids.ts';
import type { PushSubscriptions } from '../../platform/db/schema.ts';
import { classifyPlatform, PLATFORM_CLASSES } from '@voice-room/shared/platform-class';
import type { PlatformClass } from '@voice-room/shared/platform-class';
import type { PushLocaleIntent, PushRegistrationState } from '@voice-room/shared/contracts/push-registration';
import { resolveLocale } from '@voice-room/shared/localization';
import { lockKeys, lockXact } from '../../platform/db/locks.ts';

type Metadata = Record<string, unknown>;
export function subscriptionRegistration(record: PushSubscriptionRecord): PushRegistrationState {
  return {
    protocol: 1,
    locale: resolveLocale([], record.metadata.locale),
    version: typeof record.metadata.registrationVersion === 'string' ? record.metadata.registrationVersion : record.id
  };
}
export type PushSubscriptionRecord = {
  id: string;
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  lastSuccessAt: number | null;
  platformClass: PlatformClass;
  metadata: Metadata;
};

function mapSubscription(row: Selectable<PushSubscriptions>): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    createdAt: row.created_at.getTime(),
    lastSuccessAt: row.last_success_at?.getTime() ?? null,
    platformClass: row.platform_class || PLATFORM_CLASSES.unknown,
    metadata: isRecord(row.metadata) ? row.metadata : {}
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const PLATFORM_SIGNAL_METADATA_KEYS = new Set([
  'desktopBridge',
  'maxTouchPoints',
  'platform',
  'platformClass',
  'userAgent',
  'userAgentData',
  'userAgentDataMobile'
]);

function sanitizeMetadata(metadata: unknown): Metadata {
  if (!isRecord(metadata)) return {};

  const sanitized: Metadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (PLATFORM_SIGNAL_METADATA_KEYS.has(key) || key === 'locale' || key === 'registrationVersion') continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sameMetadata(left: Metadata, right: Metadata): boolean {
  const ordered = (value: Metadata) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function normalizePlatformClass(value: unknown): PlatformClass {
  return isOneOf(Object.values(PLATFORM_CLASSES), value) ? value : PLATFORM_CLASSES.unknown;
}

function resolvePlatformClass(metadata: Metadata | null | undefined): PlatformClass {
  const explicit = normalizePlatformClass(metadata?.platformClass);
  if (explicit !== PLATFORM_CLASSES.unknown || metadata?.platformClass === PLATFORM_CLASSES.unknown) return explicit;
  const touchPoints = metadata?.maxTouchPoints;

  return classifyPlatform({
    desktopBridge: metadata?.desktopBridge === true,
    userAgentDataMobile: typeof metadata?.userAgentDataMobile === 'boolean' ? metadata.userAgentDataMobile : undefined,
    userAgent: typeof metadata?.userAgent === 'string' ? metadata.userAgent : '',
    platform: typeof metadata?.platform === 'string' ? metadata.platform : '',
    maxTouchPoints: typeof touchPoints === 'number' && Number.isFinite(touchPoints) ? touchPoints : 0
  });
}

function createPushSubscriptionRepository({
  pool,
  maxSubscriptionsPerUser = 10
}: {
  pool: pg.Pool;
  maxSubscriptionsPerUser?: number;
}) {
  const db = kyselyOn(pool);
  const subscriptionLimit = Math.max(1, Math.floor(Number(maxSubscriptionsPerUser) || 10));

  // An endpoint moves to another user only when that user proves the same keys;
  // each user keeps their newest subscriptions up to the limit.
  async function register({
    userId,
    subscription,
    metadata = {},
    localeState
  }: {
    userId: string;
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
    metadata?: Metadata;
    localeState?: PushLocaleIntent;
  }): Promise<
    | { status: 'subscribed'; subscription: PushSubscriptionRecord; registration: PushRegistrationState }
    | { status: 'locale_conflict'; registration: PushRegistrationState | null }
    | { status: 'conflict' }
  > {
    const endpoint = text(subscription?.endpoint);
    const p256dh = text(subscription?.keys?.p256dh);
    const auth = text(subscription?.keys?.auth);
    if (!userId || !endpoint || !p256dh || !auth) return { status: 'conflict' };
    const platformClass = resolvePlatformClass(metadata);
    const safeMetadata = sanitizeMetadata(metadata);
    return db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      await lockXact(trx, lockKeys.pushTarget('web', endpoint));
      const current = await trx
        .selectFrom('push_subscriptions')
        .selectAll()
        .where('endpoint', '=', endpoint)
        .forUpdate()
        .executeTakeFirst();
      if (current && current.user_id !== userId && (current.p256dh !== p256dh || current.auth !== auth)) {
        return { status: 'conflict' };
      }
      const previous = current ? mapSubscription(current) : null;
      const state = previous ? subscriptionRegistration(previous) : null;
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
        current.p256dh !== p256dh ||
        current.auth !== auth ||
        current.platform_class !== platformClass ||
        state?.locale !== locale ||
        !sameMetadata(sanitizeMetadata(previous?.metadata), safeMetadata);
      const version = changed ? createRowId() : (state?.version ?? createRowId());
      const values = {
        user_id: userId,
        p256dh,
        auth,
        created_at: sql<Date>`current_timestamp`,
        metadata: JSON.stringify({ ...safeMetadata, locale, registrationVersion: version }),
        platform_class: platformClass
      };
      const stored = current
        ? await trx
            .updateTable('push_subscriptions')
            .set(values)
            .where('id', '=', current.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('push_subscriptions')
            .values({ id: createRowId(), endpoint, ...values })
            .returningAll()
            .executeTakeFirstOrThrow();
      await trx
        .deleteFrom('push_subscriptions')
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('push_subscriptions')
            .select('id')
            .where('user_id', '=', userId)
            .orderBy(sql`CASE WHEN endpoint = ${endpoint} THEN 0 ELSE 1 END`)
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .offset(subscriptionLimit)
        )
        .execute();
      return {
        status: 'subscribed',
        subscription: mapSubscription(stored),
        registration: { protocol: 1, locale, version }
      };
    });
  }

  async function upsert(input: Parameters<typeof register>[0]): Promise<PushSubscriptionRecord | null> {
    const result = await register(input);
    return result.status === 'subscribed' ? result.subscription : null;
  }

  async function remove({ userId, endpoint }: { userId: string; endpoint: unknown }): Promise<boolean> {
    const result = await db
      .deleteFrom('push_subscriptions')
      .where('user_id', '=', userId)
      .where('endpoint', '=', text(endpoint))
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async function removeByEndpoint(endpoint: string): Promise<void> {
    await db.deleteFrom('push_subscriptions').where('endpoint', '=', endpoint).execute();
  }

  async function listByUserId(userId: string): Promise<PushSubscriptionRecord[]> {
    const rows = await db
      .selectFrom('push_subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at')
      .execute();
    return rows.map(mapSubscription);
  }

  async function markSuccess(endpoint: string): Promise<void> {
    await db
      .updateTable('push_subscriptions')
      .set({ last_success_at: sql<Date>`current_timestamp` })
      .where('endpoint', '=', endpoint)
      .execute();
  }

  return { listByUserId, markSuccess, remove, removeByEndpoint, upsert, register };
}

export type PushSubscriptionRepository = ReturnType<typeof createPushSubscriptionRepository>;

export { createPushSubscriptionRepository };
