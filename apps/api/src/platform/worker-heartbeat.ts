import os from 'node:os';
import { createDbPool } from '../lib/db.js';
import { createRuntimeReadinessRepository } from './runtime-readiness-repository.ts';

const WORKER_CAPABILITIES: Readonly<Record<string, string[]>> = Object.freeze({
  'media-maintenance': ['media-maintenance.G78'],
  'media-processing': ['media-processing.G77', 'media-pressure.G80'],
  'media-reconciliation': ['media-reconciliation.G79'],
  'message-delivery': ['message-delivery.G38'],
  'notification-delivery': ['notification-delivery.G63']
});

export type WorkerHeartbeat = Readonly<{ close: () => Promise<void> }>;

async function startWorkerHeartbeat({ env = process.env, workerName }: { env?: NodeJS.ProcessEnv; workerName?: string } = {}): Promise<WorkerHeartbeat> {
  const capabilityTokens = WORKER_CAPABILITIES[workerName as string];
  const databaseUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!capabilityTokens || !databaseUrl) return Object.freeze({ close: async () => {} });
  const id = String(env.CAPABILITY_RUNTIME_ID || `${os.hostname()}:${workerName}`).trim();
  const intervalMs = Math.max(1_000, Number(env.CAPABILITY_HEARTBEAT_INTERVAL_MS) || 5_000);
  const pool = createDbPool({ databaseUrl });
  const repository = createRuntimeReadinessRepository({ client: pool });
  let timer: ReturnType<typeof setInterval> | null = null;
  const beat = () => repository.heartbeat({
    kind: 'worker',
    id,
    capabilityTokens,
    ready: true
  });
  await beat();
  timer = setInterval(() => { void beat().catch(() => {}); }, intervalMs);
  timer.unref?.();
  return Object.freeze({
    close: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await repository.remove('worker', id).catch(() => {});
      await pool.end();
    }
  });
}

export { WORKER_CAPABILITIES, startWorkerHeartbeat };
