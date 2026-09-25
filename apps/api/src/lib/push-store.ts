import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../platform/db/kysely.ts';
import type { PushSubscriptions } from '../platform/db/schema.ts';
import { classifyPlatform, PLATFORM_CLASSES } from '@voice-room/shared/platform-class';
import type { PlatformClass } from '@voice-room/shared/platform-class';

type Metadata = Record<string, unknown>;
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

function createRowId(): string {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

function mapSubscription(row: Selectable<PushSubscriptions>): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    createdAt: row.created_at.getTime(),
    lastSuccessAt: row.last_success_at?.getTime() ?? null,
    platformClass: row.platform_class || PLATFORM_CLASSES.unknown,
    metadata: (row.metadata as Metadata | null) || {}
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
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};

  const sanitized: Metadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (PLATFORM_SIGNAL_METADATA_KEYS.has(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function normalizePlatformClass(value: unknown): PlatformClass {
  return (Object.values(PLATFORM_CLASSES) as unknown[]).includes(value)
    ? (value as PlatformClass)
    : PLATFORM_CLASSES.unknown;
}

function resolvePlatformClass(metadata: Metadata | null | undefined): PlatformClass {
  const explicit = normalizePlatformClass(metadata?.platformClass);
  if (explicit !== PLATFORM_CLASSES.unknown || metadata?.platformClass === PLATFORM_CLASSES.unknown) return explicit;

  return classifyPlatform({
    desktopBridge: metadata?.desktopBridge === true,
    userAgentDataMobile: typeof metadata?.userAgentDataMobile === 'boolean' ? metadata.userAgentDataMobile : undefined,
    userAgent: typeof metadata?.userAgent === 'string' ? metadata.userAgent : '',
    platform: typeof metadata?.platform === 'string' ? metadata.platform : '',
    maxTouchPoints: Number.isFinite(metadata?.maxTouchPoints as number) ? Number(metadata!.maxTouchPoints) : 0
  });
}

function createPushStore({ pool, maxSubscriptionsPerUser = 10 }: { pool: pg.Pool; maxSubscriptionsPerUser?: number }) {
  const db = kyselyOn(pool);
  const subscriptionLimit = Math.max(1, Math.floor(Number(maxSubscriptionsPerUser) || 10));

  // An endpoint moves to another user only when that user proves the same keys;
  // each user keeps their newest subscriptions up to the limit.
  async function upsert({
    userId,
    subscription,
    metadata = {}
  }: {
    userId: string;
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
    metadata?: Metadata;
  }): Promise<PushSubscriptionRecord | null> {
    const endpoint = text(subscription?.endpoint);
    const p256dh = text(subscription?.keys?.p256dh);
    const auth = text(subscription?.keys?.auth);
    if (!userId || !endpoint || !p256dh || !auth) return null;
    const platformClass = resolvePlatformClass(metadata);
    const safeMetadata = sanitizeMetadata(metadata);
    return db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
      const stored = await trx
        .insertInto('push_subscriptions')
        .values({
          id: createRowId(),
          user_id: userId,
          endpoint,
          p256dh,
          auth,
          created_at: sql<Date>`current_timestamp`,
          metadata: JSON.stringify(safeMetadata),
          platform_class: platformClass
        })
        .onConflict((oc) =>
          oc
            .column('endpoint')
            .doUpdateSet((eb) => ({
              user_id: eb.ref('excluded.user_id'),
              p256dh: eb.ref('excluded.p256dh'),
              auth: eb.ref('excluded.auth'),
              created_at: sql<Date>`current_timestamp`,
              metadata: eb.ref('excluded.metadata'),
              platform_class: eb.ref('excluded.platform_class')
            }))
            .where((eb) =>
              eb.or([
                eb('push_subscriptions.user_id', '=', eb.ref('excluded.user_id')),
                eb.and([
                  eb('push_subscriptions.p256dh', '=', eb.ref('excluded.p256dh')),
                  eb('push_subscriptions.auth', '=', eb.ref('excluded.auth'))
                ])
              ])
            )
        )
        .returningAll()
        .executeTakeFirst();
      if (!stored) return null;
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
      return mapSubscription(stored);
    });
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

  return { listByUserId, markSuccess, remove, removeByEndpoint, upsert };
}

export type PushStore = ReturnType<typeof createPushStore>;

export { createPushStore, mapSubscription, resolvePlatformClass, sanitizeMetadata };
