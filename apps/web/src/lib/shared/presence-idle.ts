import type { PresenceStatus } from '$lib/shared/presence';

export const PRESENCE_IDLE_THRESHOLD_SECONDS = 5 * 60;
export const PRESENCE_ACTIVE_LEASE_SECONDS = 3 * 60;
const PRESENCE_LEASE_RENEWAL_TARGET_SECONDS = PRESENCE_IDLE_THRESHOLD_SECONDS
  - PRESENCE_ACTIVE_LEASE_SECONDS
  - 15;
const PRESENCE_IDLE_RETRY_INTERVAL_MS = 5_000;
const PRESENCE_IDLE_INACTIVE_STATUS_INTERVAL_MS = 60_000;

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

interface BrowserIdleDetector extends EventTarget {
  screenState: 'locked' | 'unlocked' | null;
  userState: 'active' | 'idle' | null;
  start: (options: { signal: AbortSignal; threshold: number }) => Promise<void>;
}

interface BrowserIdleDetectorConstructor {
  new (): BrowserIdleDetector;
}

type IdleDetectionScope = {
  IdleDetector?: BrowserIdleDetectorConstructor;
  navigator?: {
    permissions?: {
      query: (descriptor: { name: string }) => Promise<{ state: PermissionState }>;
    };
  };
};

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
}: PresenceIdleControllerOptions): { evaluate: () => Promise<number | null>; stop: () => void } {
  let stopped = false;
  let currentEvaluation: Promise<number | null> | null = null;
  let evaluateAgain = false;

  async function runEvaluation(): Promise<number | null> {
    let lastIdleSeconds: number | null = null;
    do {
      evaluateAgain = false;
      const idleSeconds = await getIdleSeconds();
      lastIdleSeconds = idleSeconds;
      if (stopped) return lastIdleSeconds;
      const presence = getPresence();
      const nextStatus = getAutomaticPresenceTransition({
        ...presence,
        idleSeconds
      });
      // Stop renewing this client's lease early enough for it to expire near the
      // away threshold. Another active desktop keeps renewing its own lease and
      // therefore still prevents account-wide AFK.
      const shouldRenewOnline = presence.loaded !== false
        && presence.presenceStatus === 'online'
        && idleSeconds !== null
        && Number.isSafeInteger(idleSeconds)
        && idleSeconds >= 0
        && idleSeconds < PRESENCE_IDLE_THRESHOLD_SECONDS - PRESENCE_ACTIVE_LEASE_SECONDS;
      if (nextStatus || shouldRenewOnline) await updatePresence(nextStatus || 'online');
    } while (evaluateAgain && !stopped);
    return lastIdleSeconds;
  }

  function evaluate(): Promise<number | null> {
    if (stopped) return Promise.resolve(null);
    if (currentEvaluation) {
      evaluateAgain = true;
      return currentEvaluation;
    }
    const evaluation = runEvaluation()
      .catch(() => null)
      .finally(() => {
        currentEvaluation = null;
      });
    currentEvaluation = evaluation;
    return evaluation;
  }

  return {
    evaluate,
    stop() {
      stopped = true;
      evaluateAgain = false;
    }
  };
}

export function getNextPresenceIdleCheckDelayMs({
  idleSeconds,
  loaded = true,
  presenceStatus,
  presenceStatusAutomatic
}: PresenceIdleSnapshot & { idleSeconds: number | null }): number {
  if (!loaded || idleSeconds === null || !Number.isSafeInteger(idleSeconds) || idleSeconds < 0) {
    return PRESENCE_IDLE_RETRY_INTERVAL_MS;
  }
  if (presenceStatus === 'away' && presenceStatusAutomatic) return PRESENCE_IDLE_RETRY_INTERVAL_MS;
  if (presenceStatus !== 'online') return PRESENCE_IDLE_INACTIVE_STATUS_INTERVAL_MS;

  const remainingSeconds = Math.max(0, PRESENCE_IDLE_THRESHOLD_SECONDS - idleSeconds);
  if (remainingSeconds === 0) return PRESENCE_IDLE_RETRY_INTERVAL_MS;
  if (idleSeconds < PRESENCE_LEASE_RENEWAL_TARGET_SECONDS) {
    return Math.max(
      PRESENCE_IDLE_RETRY_INTERVAL_MS,
      (PRESENCE_LEASE_RENEWAL_TARGET_SECONDS - idleSeconds) * 1_000
    );
  }
  return Math.max(PRESENCE_IDLE_RETRY_INTERVAL_MS, remainingSeconds * 1_000);
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

export async function hasGrantedBrowserIdlePermission(
  scope: IdleDetectionScope = globalThis as IdleDetectionScope
): Promise<boolean> {
  if (typeof scope.IdleDetector !== 'function' || typeof scope.navigator?.permissions?.query !== 'function') {
    return false;
  }
  try {
    const permission = await scope.navigator.permissions.query({ name: 'idle-detection' });
    return permission.state === 'granted';
  } catch {
    return false;
  }
}

export async function startGrantedBrowserPresenceIdleTracking({
  getPresence,
  updatePresence,
  signal,
  scope = globalThis as IdleDetectionScope
}: {
  getPresence: () => PresenceIdleSnapshot;
  updatePresence: (status: 'online' | 'away') => Promise<void>;
  signal: AbortSignal;
  scope?: IdleDetectionScope;
}): Promise<(() => void) | null> {
  if (!(await hasGrantedBrowserIdlePermission(scope)) || signal.aborted || !scope.IdleDetector) return null;

  const detector = new scope.IdleDetector();
  let stopped = false;
  let currentEvaluation: Promise<void> | null = null;
  let evaluateAgain = false;

  async function runEvaluation(): Promise<void> {
    do {
      evaluateAgain = false;
      if (stopped || signal.aborted) return;
      const isIdle = detector.userState === 'idle' || detector.screenState === 'locked';
      if (detector.userState === null && detector.screenState === null) return;
      const nextStatus = getAutomaticPresenceTransition({
        ...getPresence(),
        idleSeconds: isIdle ? PRESENCE_IDLE_THRESHOLD_SECONDS : 0
      });
      if (nextStatus) await updatePresence(nextStatus);
    } while (evaluateAgain && !stopped && !signal.aborted);
  }

  function evaluate(): void {
    if (stopped || signal.aborted) return;
    if (currentEvaluation) {
      evaluateAgain = true;
      return;
    }
    currentEvaluation = runEvaluation()
      .catch(() => {})
      .finally(() => {
        currentEvaluation = null;
        if (evaluateAgain && !stopped && !signal.aborted) {
          evaluateAgain = false;
          evaluate();
        }
      });
  }

  detector.addEventListener('change', evaluate);
  try {
    await detector.start({
      signal,
      threshold: PRESENCE_IDLE_THRESHOLD_SECONDS * 1_000
    });
  } catch {
    detector.removeEventListener('change', evaluate);
    return null;
  }
  if (signal.aborted) {
    detector.removeEventListener('change', evaluate);
    return null;
  }
  evaluate();

  return () => {
    stopped = true;
    evaluateAgain = false;
    detector.removeEventListener('change', evaluate);
  };
}

export function startSystemPresenceIdleTracking({
  getPresence,
  updatePresence,
  onAvailabilityChange = () => {}
}: {
  getPresence: () => PresenceIdleSnapshot;
  updatePresence: (status: 'online' | 'away') => Promise<void>;
  onAvailabilityChange?: (available: boolean) => void;
}): () => void {
  const getIdleSeconds = getDesktopIdleSecondsReader();
  onAvailabilityChange(false);

  if (getIdleSeconds) {
    const controller = createPresenceIdleController({ getIdleSeconds, getPresence, updatePresence });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    onAvailabilityChange(true);

    async function evaluateAndSchedule(): Promise<void> {
      const idleSeconds = await controller.evaluate();
      if (stopped) return;
      timer = globalThis.setTimeout(
        () => void evaluateAndSchedule(),
        getNextPresenceIdleCheckDelayMs({ ...getPresence(), idleSeconds })
      );
    }
    void evaluateAndSchedule();

    return () => {
      stopped = true;
      if (timer) globalThis.clearTimeout(timer);
      controller.stop();
      onAvailabilityChange(false);
    };
  }

  const abortController = new AbortController();
  let stopped = false;
  let stopBrowserTracking: (() => void) | null = null;
  void startGrantedBrowserPresenceIdleTracking({
    getPresence,
    updatePresence,
    signal: abortController.signal
  }).then((stop) => {
    if (stopped) {
      stop?.();
      return;
    }
    stopBrowserTracking = stop;
    onAvailabilityChange(Boolean(stop));
  });

  return () => {
    stopped = true;
    abortController.abort();
    stopBrowserTracking?.();
    onAvailabilityChange(false);
  };
}
