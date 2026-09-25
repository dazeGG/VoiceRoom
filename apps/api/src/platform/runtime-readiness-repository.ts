import type pg from 'pg';

type QueryClient = Pick<pg.Pool, 'query'>;
type RuntimeKind = 'api' | 'worker';

type HeartbeatRow = {
  runtime_id: string;
  capability_tokens: string[] | null;
  manifest_digest: string | null;
  manifest_schema_version: number | string | null;
  contract_version: string | null;
  public_capabilities: string[] | null;
  ready: boolean | null;
  updated_at: unknown;
};

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

function createRuntimeReadinessRepository({ client }: { client: QueryClient | null | undefined }) {
  if (!client?.query) throw new TypeError('Runtime readiness repository requires a query client');
  const db = client;

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
    await db.query(
      `INSERT INTO capability_runtime_heartbeats (
         runtime_kind, runtime_id, capability_tokens, manifest_digest,
         manifest_schema_version, contract_version, public_capabilities, ready, updated_at
       ) VALUES ($1, $2, $3::text[], $4, $5, $6, $7::text[], $8, current_timestamp)
       ON CONFLICT (runtime_kind, runtime_id) DO UPDATE SET
         capability_tokens = EXCLUDED.capability_tokens,
         manifest_digest = EXCLUDED.manifest_digest,
         manifest_schema_version = EXCLUDED.manifest_schema_version,
         contract_version = EXCLUDED.contract_version,
         public_capabilities = EXCLUDED.public_capabilities,
         ready = EXCLUDED.ready,
         updated_at = current_timestamp`,
      [
        kind,
        id.trim(),
        normalizeTokens(capabilityTokens),
        manifestDigest,
        manifestSchemaVersion,
        contractVersion,
        normalizeTokens(publicCapabilities),
        ready === true
      ]
    );
  }

  async function listFresh(kind: RuntimeKind, { maxAgeMs }: { maxAgeMs?: unknown }): Promise<RuntimeHeartbeat[]> {
    const age = Number.isFinite(maxAgeMs) && (maxAgeMs as number) > 0 ? Math.trunc(maxAgeMs as number) : 15_000;
    const result = await db.query<HeartbeatRow>(
      `SELECT runtime_id, capability_tokens, manifest_digest, manifest_schema_version,
              contract_version, public_capabilities, ready, updated_at
       FROM capability_runtime_heartbeats
       WHERE runtime_kind = $1
         AND updated_at >= current_timestamp - ($2::bigint * interval '1 millisecond')
       ORDER BY runtime_id ASC`,
      [kind, age]
    );
    return result.rows.map((row) => ({
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
    await db.query('DELETE FROM capability_runtime_heartbeats WHERE runtime_kind = $1 AND runtime_id = $2', [kind, id]);
  }

  return Object.freeze({ heartbeat, listFresh, remove });
}

export type RuntimeReadinessRepository = ReturnType<typeof createRuntimeReadinessRepository>;

export { createRuntimeReadinessRepository, normalizeTokens };
