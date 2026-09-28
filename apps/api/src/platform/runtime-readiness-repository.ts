import { sql } from 'kysely';
import { kyselyOn, type Queryable } from './db/kysely.ts';

type RuntimeKind = 'api' | 'worker';

export type RuntimeHeartbeat = {
  id: string;
  capabilityTokens: string[];
  manifestDigest: string | null;
  manifestSchemaVersion: number | null;
  contractVersion: string | null;
  public: string[];
  ready: boolean;
  updatedAt: unknown;
};

function normalizeTokens(tokens: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(tokens) ? tokens : [])
        .filter((token): token is string => typeof token === 'string' && Boolean(token.trim()))
        .map((token) => token.trim())
    )
  ].sort();
}

function createRuntimeReadinessRepository({ client }: { client: Queryable | null | undefined }) {
  if (!client?.query) throw new TypeError('Runtime readiness repository requires a query client');
  const db = kyselyOn(client);

  async function heartbeat({
    kind,
    id,
    capabilityTokens = [],
    manifestDigest = null,
    manifestSchemaVersion = null,
    contractVersion = null,
    publicCapabilities = [],
    ready = true
  }: {
    kind: RuntimeKind;
    id: string;
    capabilityTokens?: unknown;
    manifestDigest?: string | null;
    manifestSchemaVersion?: number | null;
    contractVersion?: string | null;
    publicCapabilities?: unknown;
    ready?: boolean;
  }): Promise<void> {
    if (!['api', 'worker'].includes(kind)) throw new TypeError('Runtime heartbeat kind is invalid');
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Runtime heartbeat id is required');
    // Timestamps come from the database clock, which every replica shares.
    const row = {
      runtime_kind: kind,
      runtime_id: id.trim(),
      capability_tokens: normalizeTokens(capabilityTokens),
      manifest_digest: manifestDigest,
      manifest_schema_version: manifestSchemaVersion,
      contract_version: contractVersion,
      public_capabilities: normalizeTokens(publicCapabilities),
      ready: ready === true,
      updated_at: sql<Date>`current_timestamp`
    };
    await db
      .insertInto('capability_runtime_heartbeats')
      .values(row)
      .onConflict((conflict) =>
        conflict.columns(['runtime_kind', 'runtime_id']).doUpdateSet({
          capability_tokens: (eb) => eb.ref('excluded.capability_tokens'),
          manifest_digest: (eb) => eb.ref('excluded.manifest_digest'),
          manifest_schema_version: (eb) => eb.ref('excluded.manifest_schema_version'),
          contract_version: (eb) => eb.ref('excluded.contract_version'),
          public_capabilities: (eb) => eb.ref('excluded.public_capabilities'),
          ready: (eb) => eb.ref('excluded.ready'),
          updated_at: sql<Date>`current_timestamp`
        })
      )
      .execute();
  }

  async function listFresh(kind: RuntimeKind, { maxAgeMs }: { maxAgeMs?: unknown }): Promise<RuntimeHeartbeat[]> {
    const age = Number.isFinite(maxAgeMs) && (maxAgeMs as number) > 0 ? Math.trunc(maxAgeMs as number) : 15_000;
    const rows = await db
      .selectFrom('capability_runtime_heartbeats')
      .select([
        'runtime_id',
        'capability_tokens',
        'manifest_digest',
        'manifest_schema_version',
        'contract_version',
        'public_capabilities',
        'ready',
        'updated_at'
      ])
      .where('runtime_kind', '=', kind)
      .where('updated_at', '>=', sql<Date>`current_timestamp - (${age}::bigint * interval '1 millisecond')`)
      .orderBy('runtime_id', 'asc')
      .execute();
    return rows.map((row) => ({
      id: row.runtime_id,
      capabilityTokens: normalizeTokens(row.capability_tokens),
      manifestDigest: row.manifest_digest,
      manifestSchemaVersion: row.manifest_schema_version == null ? null : Number(row.manifest_schema_version),
      contractVersion: row.contract_version,
      public: normalizeTokens(row.public_capabilities),
      ready: row.ready === true,
      updatedAt: row.updated_at
    }));
  }

  async function remove(kind: RuntimeKind, id: string): Promise<void> {
    await db
      .deleteFrom('capability_runtime_heartbeats')
      .where('runtime_kind', '=', kind)
      .where('runtime_id', '=', id)
      .execute();
  }

  return Object.freeze({ heartbeat, listFresh, remove });
}

export type RuntimeReadinessRepository = ReturnType<typeof createRuntimeReadinessRepository>;

export { createRuntimeReadinessRepository };
