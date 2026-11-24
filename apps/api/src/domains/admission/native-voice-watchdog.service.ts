const CHECK_MS = 1_000;
const TICK_MS = 250;
export const MAX_NATIVE_VOICE_RETRY_MS = 8_000;
const RETRY_WINDOW_MS = 120_000;
const MAX_REMOVALS = 8;
export const MAX_NATIVE_VOICE_WATCHES = 256;
// Allow any upstream upgrade already in flight to finish before confirming absence.
const DRAIN_MS = 7_000;

type Participant = { room: string; identity: string };
type Deadline = {
  deadline: number;
  expiresAt: number;
};
type Window = Deadline & {
  refresh(): Promise<Deadline | null>;
  nextCheck: number;
};
type Cleanup = {
  drainAt: number;
  finalAt: number;
  nextAttempt: number;
  retryMs: number;
  result?: { absent: boolean; settleBy: number };
};
type Watch = Participant & {
  window?: Window;
  cleanup?: Cleanup;
  retirement?: string;
  tunnels: Set<() => void>;
};

export type CompanionWindow = Participant & Deadline;

function key({ room, identity }: Participant): string {
  return JSON.stringify([room, identity]);
}

export function nativeVoiceRetryDelay(base: number): number {
  return base * (0.75 + Math.random() * 0.25);
}

export function createNativeVoiceWatchdog({
  remove,
  report
}: {
  remove: (room: string, identity: string) => Promise<void>;
  report: (error: unknown, participant: Participant, final: boolean) => void;
}) {
  const watches = new Map<string, Watch>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let removing = 0;
  let exhausted = 0;

  function getOrAdd(participant: Participant): Watch | undefined {
    const id = key(participant);
    const existing = watches.get(id);
    if (existing || watches.size >= MAX_NATIVE_VOICE_WATCHES) return existing;
    const watch = { ...participant, tunnels: new Set<() => void>() };
    watches.set(id, watch);
    return watch;
  }

  function cut(watch: Watch, now: number, retiredAt?: number): void {
    if (!watch.cleanup) {
      const drainAt = (retiredAt ?? now) + DRAIN_MS;
      watch.cleanup = {
        drainAt,
        finalAt: (retiredAt ?? now) + RETRY_WINDOW_MS,
        nextAttempt: watch.window || retiredAt === undefined ? now : drainAt,
        retryMs: CHECK_MS
      };
    }
    for (const close of watch.tunnels) close();
    watch.tunnels.clear();
  }

  async function clean(watch: Watch, cleanup: Cleanup, now: number): Promise<void> {
    const final = now >= cleanup.finalAt;
    cleanup.nextAttempt = Infinity;
    removing += 1;
    try {
      await remove(watch.room, watch.identity);
      if (now >= cleanup.drainAt) cleanup.result = { absent: true, settleBy: Date.now() + DRAIN_MS };
      else cleanup.nextAttempt = cleanup.drainAt;
    } catch (error) {
      if (final) {
        cleanup.result = { absent: false, settleBy: Date.now() + DRAIN_MS };
        exhausted += 1;
      } else {
        cleanup.nextAttempt = Math.min(cleanup.finalAt, Date.now() + nativeVoiceRetryDelay(cleanup.retryMs));
        cleanup.retryMs = Math.min(cleanup.retryMs * 2, MAX_NATIVE_VOICE_RETRY_MS);
      }
      report(error, watch, final);
    } finally {
      removing -= 1;
      pump(Date.now());
    }
  }

  function pump(now: number): void {
    if (!timer || removing >= MAX_REMOVALS) return;
    const due = [...watches.values()].flatMap((watch) => {
      const { cleanup } = watch;
      if (!cleanup || cleanup.nextAttempt > now) return [];
      // Give each new cutoff a first attempt before ordinary retries.
      const priority = now >= cleanup.finalAt ? 0 : cleanup.retryMs === CHECK_MS ? 1 : 2;
      return [{ watch, cleanup, priority }];
    });
    due.sort((a, b) => a.priority - b.priority || a.cleanup.nextAttempt - b.cleanup.nextAttempt);
    for (const { watch, cleanup } of due.slice(0, MAX_REMOVALS - removing)) void clean(watch, cleanup, now);
  }

  async function refresh(watch: Watch, window: Window): Promise<void> {
    window.nextCheck = Infinity;
    try {
      const refreshed = await window.refresh();
      const now = Date.now();
      if (watches.get(key(watch)) !== watch || watch.cleanup) return;
      if (!refreshed || Math.min(refreshed.deadline, window.deadline) <= now) {
        cut(watch, now);
        pump(now);
      } else {
        window.deadline = refreshed.deadline;
        window.expiresAt = refreshed.expiresAt;
      }
    } catch {
      // A failed or hung database check cannot move the cached deadline.
    } finally {
      window.nextCheck = Date.now() + CHECK_MS;
    }
  }

  function tick(): void {
    const now = Date.now();
    for (const [id, watch] of watches) {
      const { window, cleanup, retirement } = watch;
      if (cleanup) {
        // Keep a cutoff through credential expiry. Allow time to persist the
        // settlement without letting a failed database hold a watch forever.
        if (cleanup.result) {
          const expiry = window?.expiresAt ?? 0;
          const keepUntil = retirement ? Math.max(expiry, cleanup.result.settleBy) : expiry;
          if (keepUntil <= now) watches.delete(id);
        }
      } else if (window) {
        if (window.deadline <= now) cut(watch, now);
        else if (window.nextCheck <= now) void refresh(watch, window);
      }
    }
    pump(now);
  }

  function allows(window: CompanionWindow): boolean {
    const watch = watches.get(key(window));
    const now = Date.now();
    if (window.deadline <= now) return false;
    if (!watch) return watches.size < MAX_NATIVE_VOICE_WATCHES;
    return !watch.cleanup && (watch.window?.deadline ?? 0) > now;
  }

  function observe(window: CompanionWindow, refreshWindow: Window['refresh']): Watch | undefined {
    const watch = getOrAdd(window);
    if (watch) watch.window ??= { ...window, refresh: refreshWindow, nextCheck: Date.now() + CHECK_MS };
    return watch;
  }

  return {
    allows,
    track(window: CompanionWindow, refreshWindow: Window['refresh'], close: () => void) {
      if (!allows(window)) return null;
      const watch = observe(window, refreshWindow);
      if (!watch) return null;
      watch.tunnels.add(close);
      return () => watch.tunnels.delete(close);
    },
    recover(participant: Participant, window: CompanionWindow | undefined, refreshWindow: Window['refresh']) {
      if (window && window.deadline > Date.now()) return Boolean(observe(window, refreshWindow));
      const watch = getOrAdd(participant);
      if (!watch) return false;
      cut(watch, Date.now());
      pump(Date.now());
      return true;
    },
    retire(participant: Participant, id: string, retiredAt: number) {
      const watch = getOrAdd(participant);
      if (!watch) return false;
      watch.retirement = id;
      cut(watch, Date.now(), retiredAt);
      pump(Date.now());
      return true;
    },
    retirements() {
      return [...watches.values()].flatMap(({ retirement }) => (retirement ? [retirement] : []));
    },
    settlements() {
      return [...watches.entries()].flatMap(([watchKey, { retirement, cleanup }]) => {
        if (!retirement || !cleanup?.result) return [];
        return [
          {
            id: retirement,
            absent: cleanup.result.absent,
            acknowledge() {
              const watch = watches.get(watchKey);
              if (watch?.cleanup === cleanup && watch.retirement === retirement) watches.delete(watchKey);
            }
          }
        ];
      });
    },
    metrics() {
      return { watches: watches.size, exhausted };
    },
    start() {
      timer ??= setInterval(tick, TICK_MS);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      watches.clear();
    }
  };
}
