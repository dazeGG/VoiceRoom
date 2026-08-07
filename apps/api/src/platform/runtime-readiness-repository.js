'use strict';

function normalizeTokens(tokens) {
  return [...new Set((Array.isArray(tokens) ? tokens : [])
    .filter((token) => typeof token === 'string' && token.trim())
    .map((token) => token.trim()))].sort();
}

function createRuntimeReadinessRepository({ client }) {
  if (!client?.query) throw new TypeError('Runtime readiness repository requires a query client');

  async function heartbeat({
    kind,
    id,
    capabilityTokens = [],
    manifestDigest = null,
    manifestSchemaVersion = null,
    contractVersion = null,
    publicCapabilities = [],
    ready = true
  }) {
    if (!['api', 'worker'].includes(kind)) throw new TypeError('Runtime heartbeat kind is invalid');
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Runtime heartbeat id is required');
    await client.query(
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

  async function listFresh(kind, { maxAgeMs }) {
    const age = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? Math.trunc(maxAgeMs) : 15_000;
    const result = await client.query(
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

  async function remove(kind, id) {
    await client.query(
      'DELETE FROM capability_runtime_heartbeats WHERE runtime_kind = $1 AND runtime_id = $2',
      [kind, id]
    );
  }

  return Object.freeze({ heartbeat, listFresh, remove });
}

module.exports = { createRuntimeReadinessRepository, normalizeTokens };
