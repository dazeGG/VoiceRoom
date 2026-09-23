type TimerHandle = unknown;
type ScheduleTimer = (callback: () => void, delay: number) => TimerHandle;
type CancelTimer = (timer: TimerHandle) => void;

interface GraceEntry {
  startedAt: number;
  elapsed: boolean;
  onExpire: () => void;
  timer: TimerHandle | null;
}

export interface ScreenRecoveryGraceOptions {
  localGraceMs?: number;
  globalHardCapMs?: number;
  now?: () => number;
  setTimeout?: ScheduleTimer;
  clearTimeout?: CancelTimer;
}

export class ScreenRecoveryGraceController {
  readonly localGraceMs: number;
  readonly globalHardCapMs: number;
  readonly now: () => number;
  readonly scheduleTimer: ScheduleTimer;
  readonly cancelTimer: CancelTimer;
  readonly pending: Map<string, GraceEntry>;
  globalEpoch: number;
  globalActive: boolean;
  globalTimer: TimerHandle | null;

  constructor({
    localGraceMs = 8_000,
    globalHardCapMs = 35_000,
    now = Date.now,
    setTimeout: scheduleTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: cancelTimer = (timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>)
  }: ScreenRecoveryGraceOptions = {}) {
    this.localGraceMs = localGraceMs;
    this.globalHardCapMs = globalHardCapMs;
    this.now = now;
    this.scheduleTimer = (callback, delay) => scheduleTimer(callback, delay);
    this.cancelTimer = (timer) => cancelTimer(timer);
    this.pending = new Map();
    this.globalEpoch = 0;
    this.globalActive = false;
    this.globalTimer = null;
  }

  beginGlobal(epoch: number): void {
    if (this.globalActive) {
      this.globalEpoch = epoch;
      return;
    }
    this.globalActive = true;
    this.globalEpoch = epoch;
    this.globalTimer = this.scheduleTimer(() => this.endGlobal(true), this.globalHardCapMs);
  }

  schedule(key: string, onExpire: () => void): void {
    if (this.pending.has(key)) return;
    const entry: GraceEntry = { startedAt: this.now(), elapsed: false, onExpire, timer: null };
    entry.timer = this.scheduleTimer(() => {
      entry.timer = null;
      entry.elapsed = true;
      if (!this.globalActive) this.expire(key, entry);
    }, this.localGraceMs);
    this.pending.set(key, entry);
  }

  cancel(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    if (entry.timer !== null) this.cancelTimer(entry.timer);
    this.pending.delete(key);
  }

  authoritativeStop(key: string): void {
    this.cancel(key);
  }

  endGlobal(terminal = false): void {
    this.globalActive = false;
    this.globalEpoch = 0;
    if (this.globalTimer !== null) {
      this.cancelTimer(this.globalTimer);
      this.globalTimer = null;
    }
    for (const [key, entry] of [...this.pending]) {
      if (terminal || entry.elapsed || this.now() - entry.startedAt >= this.localGraceMs) this.expire(key, entry);
    }
  }

  clear(): void {
    if (this.globalTimer !== null) this.cancelTimer(this.globalTimer);
    this.globalTimer = null;
    this.globalActive = false;
    for (const key of [...this.pending.keys()]) this.cancel(key);
  }

  expire(key: string, entry: GraceEntry): void {
    if (this.pending.get(key) !== entry) return;
    this.pending.delete(key);
    entry.onExpire();
  }
}
