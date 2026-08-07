'use strict';

const fs = require('node:fs/promises');

const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_RECOVERY_BYTES = 256 * 1024 * 1024;

function createMediaPressureService({
  checkIntervalMs = 5_000,
  minFreeBytes = DEFAULT_MIN_FREE_BYTES,
  recoveryBytes = DEFAULT_RECOVERY_BYTES,
  replicaConsensus = () => true,
  onSnapshot = () => {},
  statfs = fs.statfs,
  storagePath
} = {}) {
  if (!storagePath) throw new TypeError('Media storage path is required');
  let snapshot = Object.freeze({ checkedAt: 0, freeBytes: 0, healthy: false, reason: 'unchecked' });
  let checking = null;

  async function measure({ force = false } = {}) {
    const now = Date.now();
    if (!force && snapshot.checkedAt && now - snapshot.checkedAt < checkIntervalMs) return snapshot;
    if (checking) return checking;
    checking = (async () => {
      try {
        const stats = await statfs(storagePath);
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
        snapshot = Object.freeze({ checkedAt: Date.now(), freeBytes: 0, healthy: false, reason: 'storage_unavailable' });
        onSnapshot(snapshot);
      } finally {
        checking = null;
      }
      return snapshot;
    })();
    return checking;
  }

  async function assertAcceptingUploads() {
    const state = await measure();
    if (!state.healthy) {
      const error = new Error('Media uploads are temporarily unavailable');
      error.code = 'MEDIA_PRESSURE';
      error.statusCode = 503;
      throw error;
    }
    return state;
  }

  async function canClaimWork() {
    return (await measure()).healthy;
  }

  return Object.freeze({
    assertAcceptingUploads,
    canClaimWork,
    getSnapshot: () => snapshot,
    measure
  });
}

module.exports = {
  DEFAULT_MIN_FREE_BYTES,
  DEFAULT_RECOVERY_BYTES,
  createMediaPressureService
};
