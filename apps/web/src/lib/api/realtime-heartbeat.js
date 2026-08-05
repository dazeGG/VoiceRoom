export class RealtimeHeartbeatWatchdog {
  constructor({ timeoutMs, now = Date.now }) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive finite number');
    }
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.pendingSince = null;
  }

  recordPing() {
    if (this.pendingSince === null) this.pendingSince = this.now();
  }

  recordPong() {
    this.pendingSince = null;
  }

  isTimedOut() {
    return this.pendingSince !== null && this.now() - this.pendingSince >= this.timeoutMs;
  }

  reset() {
    this.pendingSince = null;
  }
}
