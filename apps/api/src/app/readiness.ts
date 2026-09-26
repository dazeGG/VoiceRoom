// The capability readiness provider for an API replica, configured from the
// environment (CAPABILITY_* variables).

import type pg from 'pg';
import { createRuntimeReadinessProvider } from '../platform/runtime-readiness.ts';
import { readinessReadySetFromEnv, type readApiConfig } from './config.ts';

type ApiConfig = ReturnType<typeof readApiConfig>;

export function createApiReadiness(config: ApiConfig, env: NodeJS.ProcessEnv, pool: () => pg.Pool | null) {
  const ready = (name: string) => readinessReadySetFromEnv(name, env);
  return createRuntimeReadinessProvider({
    expectedApiReplicaIds: config.CAPABILITY_EXPECTED_API_REPLICA_IDS,
    getClient: pool,
    heartbeatIntervalMs: config.CAPABILITY_HEARTBEAT_INTERVAL_MS,
    heartbeatMaxAgeMs: config.CAPABILITY_HEARTBEAT_MAX_AGE_MS,
    manifestPath: config.CAPABILITY_DAG_PATH,
    runtimeId: config.CAPABILITY_API_REPLICA_ID,
    getReadinessOptions: () => ({
      desired: config.CAPABILITY_DESIRED,
      binaryReady: ready('CAPABILITY_READY_BINARY'),
      schemaReady: ready('CAPABILITY_READY_SCHEMA'),
      indexReady: ready('CAPABILITY_READY_INDEX'),
      configReady: ready('CAPABILITY_READY_CONFIG'),
      apiReady: ready('CAPABILITY_READY_API'),
      webReady: ready('CAPABILITY_READY_WEB'),
      visibilityReady: ready('CAPABILITY_READY_VISIBILITY'),
      workerReady: ready('CAPABILITY_READY_WORKER'),
      internalReady: ready('CAPABILITY_READY_INTERNAL')
    })
  });
}
