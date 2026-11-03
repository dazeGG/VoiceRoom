// How long the server stayed out of this page's reach. A socket that fails to
// open never reaches the server, so its logs cannot show the failure: only the
// page can tell, and only once the connection is back.

// Shorter than this is a server restart or a bad moment, which reconnecting already covers.
const REPORTED_FROM_MS = 30_000;
// Longer than any real wait between two signs of life (a connect timeout and a
// retry, a dead socket being noticed, a hidden tab's timers running once a
// minute): such a gap is a computer that slept, and it does not count at all.
const SLEEP_GAP_MS = 90_000;

export type RealtimeOutageReport = {
  durationMs: number;
  /** Connections that failed before one opened. */
  attempts: number;
  /** The browser said it had no network at some attempt: the cause is on this side. */
  offline: boolean;
};

export class RealtimeOutage {
  private lastSeenAt: number | null = null;
  private unreachableMs = 0;
  private attempts = 0;
  private offline = false;

  private advance(now: number): void {
    if (this.lastSeenAt !== null && now - this.lastSeenAt <= SLEEP_GAP_MS) this.unreachableMs += now - this.lastSeenAt;
    this.lastSeenAt = now;
  }

  /** An open socket was lost; the server was last known to be there at `lastAlive`. */
  noteLost(lastAlive: number): void {
    this.lastSeenAt ??= lastAlive;
  }

  /** A socket closed or timed out without ever opening. */
  noteFailedAttempt(now: number, online: boolean): void {
    this.advance(now);
    this.attempts += 1;
    if (!online) this.offline = true;
  }

  /** A socket opened: answers the outage it ended, if one is worth reporting. */
  recovered(now: number): RealtimeOutageReport | null {
    this.advance(now);
    const report = { durationMs: this.unreachableMs, attempts: this.attempts, offline: this.offline };
    this.reset();
    return report.durationMs >= REPORTED_FROM_MS ? report : null;
  }

  reset(): void {
    this.lastSeenAt = null;
    this.unreachableMs = 0;
    this.attempts = 0;
    this.offline = false;
  }
}
