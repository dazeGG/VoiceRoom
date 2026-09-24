import type pg from 'pg';
import { PUBLIC_CAPABILITY_KEYS } from '@voice-room/shared/capabilities';
import { createReadinessReport, resolveManifestPath, type ReadinessOptions, type ReadinessReport, type ReplicaInput } from './readiness.ts';
import { createRuntimeReadinessRepository, type RuntimeReadinessRepository } from './runtime-readiness-repository.ts';

function asSet(value: unknown): Set<string> {
  if (value instanceof Set) return new Set(value as Set<string>);
  return new Set(Array.isArray(value) ? value : []);
}

function failClosedSnapshot(manifestPath: string, options: ReadinessOptions): ReadinessReport {
  return createReadinessReport(manifestPath, {
    ...options,
    workerReady: [],
    replicas: [],
    requireReplicaConsensus: true
  });
}

function createRuntimeReadinessProvider({
  expectedApiReplicaIds,
  getClient,
  getReadinessOptions = () => ({}),
  heartbeatIntervalMs = 5_000,
  heartbeatMaxAgeMs = 15_000,
  manifestPath,
  runtimeId
}: {
  expectedApiReplicaIds?: unknown;
  getClient?: () => Pick<pg.Pool, 'query'> | null | undefined;
  getReadinessOptions?: () => ReadinessOptions;
  heartbeatIntervalMs?: number;
  heartbeatMaxAgeMs?: number;
  manifestPath?: string;
  runtimeId?: unknown;
} = {}) {
  if (typeof getClient !== 'function') throw new TypeError('Runtime readiness requires a client provider');
  if (typeof runtimeId !== 'string' || !runtimeId.trim()) throw new TypeError('Runtime readiness id is required');
  const clientProvider = getClient;
  const resolvedManifestPath = resolveManifestPath(manifestPath);
  const id = runtimeId.trim();
  const expectedIds = new Set(
    Array.isArray(expectedApiReplicaIds) && expectedApiReplicaIds.length
      ? expectedApiReplicaIds.map((value) => String(value).trim()).filter(Boolean)
      : [id]
  );
  let snapshot = failClosedSnapshot(resolvedManifestPath, getReadinessOptions());
  let timer: ReturnType<typeof setInterval> | null = null;
  let refreshing: Promise<ReadinessReport> | null = null;
  let repository: RuntimeReadinessRepository | null = null;

  async function refresh(): Promise<ReadinessReport> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const baseOptions = getReadinessOptions();
      try {
        const client = clientProvider();
        if (!client?.query) throw new Error('Runtime readiness database is unavailable');
        repository ||= createRuntimeReadinessRepository({ client });
        const workers = await repository.listFresh('worker', { maxAgeMs: heartbeatMaxAgeMs });
        const liveWorkerTokens = new Set(
          workers.filter((worker) => worker.ready).flatMap((worker) => worker.capabilityTokens)
        );
        const configuredWorkerTokens = asSet(baseOptions.workerReady);
        const workerReady = [...configuredWorkerTokens].filter((token) => liveWorkerTokens.has(token));
        const localOptions = { ...baseOptions, workerReady };
        const local = createReadinessReport(resolvedManifestPath, localOptions);
        await repository.heartbeat({
          kind: 'api',
          id,
          manifestDigest: local.manifest.digest,
          manifestSchemaVersion: local.manifest.schemaVersion,
          contractVersion: local.manifest.contractVersion,
          publicCapabilities: PUBLIC_CAPABILITY_KEYS.filter((key) => local.features[key] === true),
          ready: true
        });
        const apiRows = await repository.listFresh('api', { maxAgeMs: heartbeatMaxAgeMs });
        const present = new Set(apiRows.map((row) => row.id));
        const missing = [...expectedIds].filter((expectedId) => !present.has(expectedId));
        const replicas: ReplicaInput[] = apiRows.map((row) => ({
          id: row.id,
          manifestDigest: row.manifestDigest,
          manifestSchemaVersion: row.manifestSchemaVersion,
          contractVersion: row.contractVersion,
          public: row.public,
          ready: row.ready
        }));
        for (const missingId of missing) replicas.push({ id: missingId, ready: false, public: [] });
        snapshot = createReadinessReport(resolvedManifestPath, {
          ...localOptions,
          replicas,
          requireReplicaConsensus: true
        });
      } catch {
        snapshot = failClosedSnapshot(resolvedManifestPath, baseOptions);
      } finally {
        refreshing = null;
      }
      return snapshot;
    })();
    return refreshing;
  }

  async function start(): Promise<ReadinessReport> {
    await refresh();
    if (!timer) {
      timer = setInterval(() => { void refresh(); }, heartbeatIntervalMs);
      timer.unref?.();
    }
    return snapshot;
  }

  async function stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    try {
      const client = clientProvider();
      if (client?.query) {
        repository ||= createRuntimeReadinessRepository({ client });
        await repository.remove('api', id);
      }
    } catch {
      // A stale heartbeat expires fail-closed when the database is unavailable during shutdown.
    }
  }

  return Object.freeze({
    getSnapshot: (): ReadinessReport => snapshot,
    manifestPath: resolvedManifestPath,
    refresh,
    start,
    stop
  });
}

export type RuntimeReadinessProvider = ReturnType<typeof createRuntimeReadinessProvider>;

export { createRuntimeReadinessProvider };
