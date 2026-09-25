import fs from 'node:fs/promises';

const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_RECOVERY_BYTES = 256 * 1024 * 1024;

export type PressureSnapshot = Readonly<{
  checkedAt: number;
  freeBytes: number;
  healthy: boolean;
  reason: 'unchecked' | 'ready' | 'replica_disagreement' | 'low_disk_space' | 'storage_unavailable';
}>;

type Statfs = (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

function createMediaPressureService({
  checkIntervalMs = 5_000,
  minFreeBytes = DEFAULT_MIN_FREE_BYTES,
  recoveryBytes = DEFAULT_RECOVERY_BYTES,
  replicaConsensus = () => true,
  onSnapshot = () => {},
  statfs = fs.statfs as Statfs,
  storagePath
}: {
  checkIntervalMs?: number;
  minFreeBytes?: number;
  recoveryBytes?: number;
  replicaConsensus?: () => unknown;
  onSnapshot?: (snapshot: PressureSnapshot) => void;
  statfs?: Statfs;
  storagePath?: string;
} = {}) {
  if (!storagePath) throw new TypeError('Media storage path is required');
  const target = storagePath;
  let snapshot: PressureSnapshot = Object.freeze({ checkedAt: 0, freeBytes: 0, healthy: false, reason: 'unchecked' });
  let checking: Promise<PressureSnapshot> | null = null;

  async function measure({ force = false }: { force?: boolean } = {}): Promise<PressureSnapshot> {
    const now = Date.now();
    if (!force && snapshot.checkedAt && now - snapshot.checkedAt < checkIntervalMs) return snapshot;
    if (checking) return checking;
    checking = (async () => {
      try {
        const stats = await statfs(target);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        const threshold = snapshot.healthy ? minFreeBytes : minFreeBytes + recoveryBytes;
        const replicasAgree = (await replicaConsensus()) === true;
        const localHealthy = Number.isFinite(freeBytes) && freeBytes >= threshold;
        snapshot = Object.freeze({
          checkedAt: Date.now(),
          freeBytes,
          healthy: localHealthy && replicasAgree,
          reason: !replicasAgree ? 'replica_disagreement' : localHealthy ? 'ready' : 'low_disk_space'
        });
        onSnapshot(snapshot);
      } catch {
        snapshot = Object.freeze({
          checkedAt: Date.now(),
          freeBytes: 0,
          healthy: false,
          reason: 'storage_unavailable'
        });
        onSnapshot(snapshot);
      } finally {
        checking = null;
      }
      return snapshot;
    })();
    return checking;
  }

  async function assertAcceptingUploads(): Promise<PressureSnapshot> {
    const state = await measure();
    if (!state.healthy) {
      const error = new Error('Media uploads are temporarily unavailable') as Error & {
        code?: string;
        statusCode?: number;
      };
      error.code = 'MEDIA_PRESSURE';
      error.statusCode = 503;
      throw error;
    }
    return state;
  }

  async function canClaimWork(): Promise<boolean> {
    return (await measure()).healthy;
  }

  return Object.freeze({
    assertAcceptingUploads,
    canClaimWork,
    getSnapshot: (): PressureSnapshot => snapshot,
    measure
  });
}

export type MediaPressureService = ReturnType<typeof createMediaPressureService>;

export { DEFAULT_MIN_FREE_BYTES, DEFAULT_RECOVERY_BYTES, createMediaPressureService };
