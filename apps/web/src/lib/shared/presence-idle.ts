import type { PresenceStatus } from '$lib/shared/presence';

export const PRESENCE_IDLE_THRESHOLD_SECONDS = 5 * 60;
export const PRESENCE_ACTIVE_LEASE_SECONDS = 3 * 60;
const PRESENCE_IDLE_POLL_INTERVAL_MS = 15_000;

export interface PresenceIdleSnapshot {
  loaded?: boolean;
  presenceStatus: PresenceStatus;
  presenceStatusAutomatic: boolean;
}

interface PresenceIdleControllerOptions {
  getIdleSeconds: () => Promise<number | null>;
  getPresence: () => PresenceIdleSnapshot;
  updatePresence: (status: 'online' | 'away') => Promise<void>;
}

interface DesktopIdleBridge {
  getSystemIdleTime: () => Promise<number>;
}

type DesktopIdleScope = {
  voiceRoomDesktopIdle?: DesktopIdleBridge;
};

export function getAutomaticPresenceTransition({
  idleSeconds,
  loaded = true,
  presenceStatus,
  presenceStatusAutomatic
}: PresenceIdleSnapshot & { idleSeconds: number | null }): 'online' | 'away' | null {
  if (!loaded || idleSeconds === null || !Number.isSafeInteger(idleSeconds) || idleSeconds < 0) return null;
  if (presenceStatus === 'online' && idleSeconds >= PRESENCE_IDLE_THRESHOLD_SECONDS) return 'away';
  if (presenceStatus === 'away' && presenceStatusAutomatic && idleSeconds < PRESENCE_IDLE_THRESHOLD_SECONDS) {
    return 'online';
  }
  return null;
}

export function createPresenceIdleController({
  getIdleSeconds,
  getPresence,
  updatePresence
}: PresenceIdleControllerOptions): { evaluate: () => Promise<void>; stop: () => void } {
  let stopped = false;
  let currentEvaluation: Promise<void> | null = null;
  let evaluateAgain = false;

  async function runEvaluation(): Promise<void> {
    do {
      evaluateAgain = false;
      const idleSeconds = await getIdleSeconds();
      if (stopped) return;
      const presence = getPresence();
      const nextStatus = getAutomaticPresenceTransition({
        ...presence,
        idleSeconds
      });
      // Stop renewing this client's lease early enough for it to expire exactly
      // when the same client reaches the away threshold. Another active desktop
      // keeps renewing its own lease and therefore still prevents account-wide AFK.
      const shouldRenewOnline = presence.loaded !== false
        && presence.presenceStatus === 'online'
        && idleSeconds !== null
        && Number.isSafeInteger(idleSeconds)
        && idleSeconds >= 0
        && idleSeconds < PRESENCE_IDLE_THRESHOLD_SECONDS - PRESENCE_ACTIVE_LEASE_SECONDS;
      if (nextStatus || shouldRenewOnline) await updatePresence(nextStatus || 'online');
    } while (evaluateAgain && !stopped);
  }

  function evaluate(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (currentEvaluation) {
      evaluateAgain = true;
      return currentEvaluation;
    }
    currentEvaluation = runEvaluation()
      .catch(() => {})
      .finally(() => {
        currentEvaluation = null;
      });
    return currentEvaluation;
  }

  return {
    evaluate,
    stop() {
      stopped = true;
      evaluateAgain = false;
    }
  };
}

export function getDesktopIdleSecondsReader(
  scope: DesktopIdleScope = globalThis as DesktopIdleScope
): (() => Promise<number | null>) | null {
  const reader = scope.voiceRoomDesktopIdle?.getSystemIdleTime;
  if (typeof reader !== 'function') return null;
  return async () => {
    try {
      const idleSeconds = await reader();
      return Number.isSafeInteger(idleSeconds) && idleSeconds >= 0 ? idleSeconds : null;
    } catch {
      return null;
    }
  };
}

export function startSystemPresenceIdleTracking({
  getPresence,
  updatePresence,
  pollIntervalMs = PRESENCE_IDLE_POLL_INTERVAL_MS
}: {
  getPresence: () => PresenceIdleSnapshot;
  updatePresence: (status: 'online' | 'away') => Promise<void>;
  pollIntervalMs?: number;
}): () => void {
  const getIdleSeconds = getDesktopIdleSecondsReader();
  if (!getIdleSeconds) return () => {};

  const controller = createPresenceIdleController({ getIdleSeconds, getPresence, updatePresence });
  const timer = globalThis.setInterval(() => void controller.evaluate(), pollIntervalMs);
  void controller.evaluate();

  return () => {
    globalThis.clearInterval(timer);
    controller.stop();
  };
}
