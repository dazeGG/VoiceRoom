export class RealtimeHeartbeatWatchdog {
  readonly timeoutMs: number;
  readonly now: () => number;
  pendingSince: number | null;

  constructor({ timeoutMs, now = Date.now }: { timeoutMs: number; now?: () => number }) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive finite number');
    }
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.pendingSince = null;
  }

  recordPing(): void {
    if (this.pendingSince === null) this.pendingSince = this.now();
  }

  recordPong(): void {
    this.pendingSince = null;
  }

  isTimedOut(): boolean {
    return this.pendingSince !== null && this.now() - this.pendingSince >= this.timeoutMs;
  }

  reset(): void {
    this.pendingSince = null;
  }
}
