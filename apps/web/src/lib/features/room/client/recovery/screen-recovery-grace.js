export class ScreenRecoveryGraceController {
  constructor({ localGraceMs = 8_000, globalHardCapMs = 35_000, now = Date.now, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout } = {}) {
    this.localGraceMs = localGraceMs;
    this.globalHardCapMs = globalHardCapMs;
    this.now = now;
    this.scheduleTimer = setTimeout;
    this.cancelTimer = clearTimeout;
    this.pending = new Map();
    this.globalEpoch = 0;
    this.globalActive = false;
    this.globalTimer = null;
  }

  beginGlobal(epoch) {
    if (this.globalActive) {
      this.globalEpoch = epoch;
      return;
    }
    this.globalActive = true;
    this.globalEpoch = epoch;
    this.globalTimer = this.scheduleTimer(() => this.endGlobal(true), this.globalHardCapMs);
  }

  schedule(key, onExpire) {
    if (this.pending.has(key)) return;
    const entry = { startedAt: this.now(), elapsed: false, onExpire, timer: null };
    entry.timer = this.scheduleTimer(() => {
      entry.timer = null;
      entry.elapsed = true;
      if (!this.globalActive) this.expire(key, entry);
    }, this.localGraceMs);
    this.pending.set(key, entry);
  }

  cancel(key) {
    const entry = this.pending.get(key);
    if (!entry) return;
    if (entry.timer !== null) this.cancelTimer(entry.timer);
    this.pending.delete(key);
  }

  authoritativeStop(key) {
    this.cancel(key);
  }

  endGlobal(terminal = false) {
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

  clear() {
    if (this.globalTimer !== null) this.cancelTimer(this.globalTimer);
    this.globalTimer = null;
    this.globalActive = false;
    for (const key of [...this.pending.keys()]) this.cancel(key);
  }

  expire(key, entry) {
    if (this.pending.get(key) !== entry) return;
    this.pending.delete(key);
    entry.onExpire();
  }
}
