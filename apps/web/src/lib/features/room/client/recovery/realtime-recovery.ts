export type RecoveryPhase =
  'idle' | 'waiting-app-snapshot' | 'waiting-livekit' | 'recovering' | 'healthy' | 'failed' | 'cancelled';

export type RecoveryFailure = {
  retryable: boolean;
  result: 'terminal' | 'retryable';
  status: number;
  code: string;
};

/** What an attempt resolves to: `{ ok: true }`, a classified failure, or whatever it rejected with. */
export type ReplacementOutcome =
  { ok?: boolean; retryable?: boolean; status?: number; code?: string } | null | undefined;

export type RecoveryTransition = Readonly<{
  epoch: number;
  appEpoch: number;
  trigger: string;
  phase: RecoveryPhase;
  attempt: number;
  elapsed: 'lt_1s' | 'lt_5s' | 'lt_15s' | 'gte_15s';
  status: number;
  code: string;
  result: string;
}>;

type TimerHandle = unknown;
type ScheduleTimer = (callback: () => void, delay: number) => TimerHandle;
type CancelTimer = (timer: TimerHandle) => void;

export interface RealtimeRecoveryOptions {
  attemptReplacement: (context: { epoch: number; attempt: number }) => ReplacementOutcome | Promise<ReplacementOutcome>;
  requestAppSnapshot: (context: { epoch: number; appEpoch: number }) => boolean | void;
  onTransition?: (event: RecoveryTransition) => void;
  now?: () => number;
  setTimeout?: ScheduleTimer;
  clearTimeout?: CancelTimer;
  random?: () => number;
  retryDelaysMs?: readonly number[];
  maxAttempts?: number;
  cooldownMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = Object.freeze([500, 1_000, 2_000, 4_000]);
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_COOLDOWN_MS = 10_000;

const TERMINAL_CODES = new Set([
  'authentication_required',
  'invalid_join',
  'invalid_session',
  'room_banned',
  'room_full',
  'room_not_found'
]);

const RETRYABLE_CODES = new Set([
  'livekit_gate_credential_unavailable',
  'livekit_gate_principal_unavailable',
  'livekit_gate_unavailable',
  'membership_persist_failed',
  'membership_unavailable',
  // The server only admits peers its roster knows; during recovery the
  // realtime re-join can still be on its way.
  'not_in_room',
  'network_error',
  'transport_error',
  'reconnect_finalize_failed',
  'superseded_join'
]);

const SAFE_CODES = new Set([...TERMINAL_CODES, ...RETRYABLE_CODES, 'unknown_error']);

export function sanitizeRecoveryCode(value: unknown): string {
  return typeof value === 'string' && SAFE_CODES.has(value) ? value : 'unknown_error';
}

export function classifyRecoveryFailure(input: unknown): RecoveryFailure {
  const error = input as { code?: unknown; status?: unknown } | null | undefined;
  const rawCode = typeof error?.code === 'string' ? error.code : '';
  const status = Number.isInteger(error?.status) ? (error?.status as number) : 0;
  if (TERMINAL_CODES.has(rawCode)) {
    return { retryable: false, result: 'terminal', status, code: rawCode };
  }
  if (RETRYABLE_CODES.has(rawCode) || status === 408 || status === 425 || status === 429 || status >= 500) {
    return { retryable: true, result: 'retryable', status, code: sanitizeRecoveryCode(rawCode) };
  }
  if (!status && !rawCode) {
    return { retryable: true, result: 'retryable', status: 0, code: 'network_error' };
  }
  return { retryable: false, result: 'terminal', status, code: sanitizeRecoveryCode(rawCode) };
}

function elapsedBucket(elapsedMs: number): RecoveryTransition['elapsed'] {
  if (elapsedMs < 1_000) return 'lt_1s';
  if (elapsedMs < 5_000) return 'lt_5s';
  if (elapsedMs < 15_000) return 'lt_15s';
  return 'gte_15s';
}

export class RealtimeRecoveryController {
  readonly attemptReplacement: RealtimeRecoveryOptions['attemptReplacement'];
  readonly requestAppSnapshot: RealtimeRecoveryOptions['requestAppSnapshot'];
  readonly onTransition: (event: RecoveryTransition) => void;
  readonly now: () => number;
  readonly schedule: ScheduleTimer;
  readonly cancelTimer: CancelTimer;
  readonly random: () => number;
  readonly retryDelaysMs: number[];
  readonly maxAttempts: number;
  readonly cooldownMs: number;
  epoch: number;
  phase: RecoveryPhase;
  active: boolean;
  appEpoch: number;
  appConnected: boolean;
  snapshotReady: boolean;
  livekitReady: boolean;
  replacementRequired: boolean;
  attempts: number;
  startedAt: number;
  effectGeneration: number;
  inFlight: boolean;
  retryTimer: TimerHandle | null;
  cooldownTimer: TimerHandle | null;
  cooldownComplete: boolean;
  cooldownCycles: number;
  meaningfulRearm: boolean;
  rearmNeedsSnapshotRequest: boolean;
  rearmSnapshotReady: boolean;
  failedAppEpoch: number;
  isNetworkOnline: boolean;
  hasSeenAppConnection: boolean;

  constructor({
    attemptReplacement,
    requestAppSnapshot,
    onTransition = (_event) => {},
    now = Date.now,
    setTimeout: schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: cancel = (timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
    random = Math.random,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    cooldownMs = DEFAULT_COOLDOWN_MS
  }: RealtimeRecoveryOptions) {
    if (typeof attemptReplacement !== 'function' || typeof requestAppSnapshot !== 'function') {
      throw new TypeError('Recovery effects must be functions');
    }
    this.attemptReplacement = attemptReplacement;
    this.requestAppSnapshot = requestAppSnapshot;
    this.onTransition = onTransition;
    this.now = now;
    this.schedule = (callback, delay) => schedule(callback, delay);
    this.cancelTimer = (timer) => cancel(timer);
    this.random = random;
    this.retryDelaysMs = [...retryDelaysMs];
    this.maxAttempts = maxAttempts;
    this.cooldownMs = cooldownMs;
    this.epoch = 0;
    this.phase = 'idle';
    this.active = false;
    this.appEpoch = 0;
    this.appConnected = false;
    this.snapshotReady = false;
    this.livekitReady = false;
    this.replacementRequired = false;
    this.attempts = 0;
    this.startedAt = 0;
    this.effectGeneration = 0;
    this.inFlight = false;
    this.retryTimer = null;
    this.cooldownTimer = null;
    this.cooldownComplete = false;
    this.cooldownCycles = 0;
    this.meaningfulRearm = false;
    this.rearmNeedsSnapshotRequest = false;
    this.rearmSnapshotReady = false;
    this.failedAppEpoch = 0;
    this.isNetworkOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    this.hasSeenAppConnection = false;
  }

  activate({ appEpoch = 0, appConnected = false }: { appEpoch?: number; appConnected?: boolean } = {}): number {
    this.cancelAllTimers();
    this.effectGeneration += 1;
    this.epoch += 1;
    this.active = true;
    this.appEpoch = appEpoch;
    this.appConnected = appConnected;
    this.hasSeenAppConnection = appConnected || appEpoch > 0;
    this.snapshotReady = false;
    this.livekitReady = false;
    this.replacementRequired = false;
    this.attempts = 0;
    this.phase = 'waiting-app-snapshot';
    this.startedAt = this.now();
    this.emit('activate', 'accepted');
    return this.epoch;
  }

  cancel(): void {
    if (!this.active && this.phase === 'cancelled') return;
    this.cancelAllTimers();
    this.effectGeneration += 1;
    this.inFlight = false;
    this.active = false;
    this.phase = 'cancelled';
    this.emit('leave', 'cancelled');
  }

  appWsLost(appEpoch: number = this.appEpoch): boolean {
    if (!this.active || appEpoch < this.appEpoch) return false;
    this.appEpoch = appEpoch;
    this.appConnected = false;
    this.snapshotReady = false;
    if (this.phase === 'failed') {
      this.emit('app_ws_lost', 'ignored');
      return false;
    }
    if (this.phase !== 'healthy') {
      this.clearRetryTimer();
      this.effectGeneration += 1;
      this.inFlight = false;
      this.epoch += 1;
      this.startedAt = this.now();
    }
    this.beginRecovery('app_ws_lost');
    this.setPhase('waiting-app-snapshot', 'app_ws_lost');
    return true;
  }

  appWsRestored(appEpoch: number): boolean {
    if (!this.active || !Number.isInteger(appEpoch) || appEpoch < this.appEpoch) return false;
    const laterEpoch = appEpoch > this.appEpoch;
    this.appEpoch = appEpoch;
    this.appConnected = true;
    this.snapshotReady = false;
    if (!this.hasSeenAppConnection) {
      this.hasSeenAppConnection = true;
      this.emit('app_ws_initial', 'accepted');
      return true;
    }
    if (this.phase === 'failed') {
      if (laterEpoch && appEpoch > this.failedAppEpoch) {
        // room-realtime already replayed room.join before announcing this restored
        // connection epoch; wait for that snapshot instead of duplicating the join.
        this.markMeaningfulRearm('app_epoch', false);
      } else {
        this.emit('app_ws_restored', 'ignored');
      }
    } else {
      this.beginRecovery('app_ws_restored');
      this.setPhase('waiting-app-snapshot', 'app_ws_restored');
    }
    return true;
  }

  appSnapshotApplied({
    appEpoch,
    active,
    hasLocalPeer
  }: {
    appEpoch: number;
    active: boolean;
    hasLocalPeer: boolean;
  }): boolean {
    if (!this.active || appEpoch !== this.appEpoch || !active || !hasLocalPeer) {
      this.emit('app_snapshot', 'rejected');
      return false;
    }
    this.snapshotReady = true;
    this.emit('app_snapshot', 'accepted');
    if (this.phase === 'failed') {
      if (this.meaningfulRearm) this.rearmSnapshotReady = true;
      this.tryRearm();
      return true;
    }
    if (this.livekitReady) this.completeHealthy('app_snapshot');
    else if (this.replacementRequired) this.maybeAttempt();
    else this.setPhase('waiting-livekit', 'app_snapshot');
    return true;
  }

  appSnapshotRequestFailed(error: unknown): void {
    if (!this.active) return;
    const classified = classifyRecoveryFailure(error);
    this.emit(
      'app_snapshot_failed',
      classified.retryable ? 'retryable' : 'terminal',
      this.attempts,
      classified.status,
      classified.code
    );
    if (classified.retryable) this.enterCooldown(classified);
    else this.fail('terminal', classified);
  }

  livekitReconnecting(): void {
    if (!this.active) return;
    this.livekitReady = false;
    this.beginRecovery('livekit_reconnecting');
    this.setPhase('waiting-livekit', 'livekit_reconnecting');
  }

  livekitReconciled(): void {
    if (!this.active) return;
    this.effectGeneration += 1;
    this.clearRetryTimer();
    this.inFlight = false;
    this.livekitReady = true;
    this.replacementRequired = false;
    this.emit('livekit_reconciled', 'accepted');
    if (this.snapshotReady) this.completeHealthy('livekit_reconciled');
  }

  livekitDisconnected(): void {
    if (!this.active) return;
    const alreadyWaiting = this.replacementRequired && !this.livekitReady;
    this.livekitReady = false;
    this.replacementRequired = true;
    if (!alreadyWaiting) {
      this.snapshotReady = false;
      this.beginRecovery('livekit_disconnected');
      this.setPhase('waiting-app-snapshot', 'livekit_disconnected');
      this.requestSnapshot();
    }
  }

  networkOffline(): void {
    if (!this.active || !this.isNetworkOnline) return;
    this.isNetworkOnline = false;
    this.beginRecovery('network_offline');
  }

  networkOnline(): void {
    if (!this.active || this.isNetworkOnline) return;
    this.isNetworkOnline = true;
    if (this.phase === 'failed') {
      this.markMeaningfulRearm('network_online', true);
      return;
    }
    if (this.replacementRequired) {
      this.snapshotReady = false;
      this.setPhase('waiting-app-snapshot', 'network_online');
      this.requestSnapshot();
    }
  }

  isCurrent(epoch: number): boolean {
    return this.active && epoch === this.epoch;
  }

  getSnapshot(): Readonly<{
    epoch: number;
    phase: RecoveryPhase;
    appEpoch: number;
    snapshotReady: boolean;
    livekitReady: boolean;
    attempts: number;
    inFlight: boolean;
  }> {
    return Object.freeze({
      epoch: this.epoch,
      phase: this.phase,
      appEpoch: this.appEpoch,
      snapshotReady: this.snapshotReady,
      livekitReady: this.livekitReady,
      attempts: this.attempts,
      inFlight: this.inFlight
    });
  }

  beginRecovery(trigger: string): void {
    if (this.phase === 'healthy') {
      this.epoch += 1;
      this.startedAt = this.now();
      this.attempts = 0;
      this.effectGeneration += 1;
    }
    if (this.phase !== 'failed') this.setPhase('recovering', trigger);
  }

  completeHealthy(trigger: string): void {
    this.cancelAllTimers();
    this.effectGeneration += 1;
    this.inFlight = false;
    this.attempts = 0;
    this.cooldownCycles = 0;
    this.setPhase('healthy', trigger, 'succeeded');
  }

  requestSnapshot(): void {
    if (!this.active || !this.appConnected) return;
    const requested = this.requestAppSnapshot({ epoch: this.epoch, appEpoch: this.appEpoch });
    if (requested === false) this.appSnapshotRequestFailed({ code: 'transport_error' });
  }

  maybeAttempt(): void {
    if (
      !this.active ||
      this.phase === 'failed' ||
      !this.snapshotReady ||
      !this.replacementRequired ||
      this.inFlight ||
      this.retryTimer
    )
      return;
    if (this.attempts >= this.maxAttempts) {
      this.enterCooldown();
      return;
    }
    const epoch = this.epoch;
    const effectGeneration = ++this.effectGeneration;
    const attempt = ++this.attempts;
    this.inFlight = true;
    this.setPhase('waiting-livekit', 'replacement_attempt');
    Promise.resolve(this.attemptReplacement({ epoch, attempt }))
      .then((outcome) => this.finishAttempt(epoch, effectGeneration, attempt, outcome))
      .catch((error: unknown) => this.finishAttempt(epoch, effectGeneration, attempt, classifyRecoveryFailure(error)));
  }

  finishAttempt(epoch: number, effectGeneration: number, attempt: number, outcome: ReplacementOutcome): void {
    if (!this.isCurrent(epoch) || effectGeneration !== this.effectGeneration) return;
    this.inFlight = false;
    if (outcome?.ok === true) {
      this.livekitReady = true;
      this.replacementRequired = false;
      this.emit('replacement_attempt', 'succeeded', attempt);
      if (this.snapshotReady) this.completeHealthy('replacement_succeeded');
      else this.setPhase('waiting-app-snapshot', 'replacement_succeeded');
      return;
    }
    const classified: ReplacementOutcome =
      typeof outcome?.retryable === 'boolean' ? outcome : classifyRecoveryFailure(outcome);
    const code = sanitizeRecoveryCode(classified?.code);
    const status = Number.isInteger(classified?.status) ? (classified?.status as number) : 0;
    this.emit('replacement_attempt', classified?.retryable ? 'retryable' : 'terminal', attempt, status, code);
    const failure = { status, code };
    if (!classified?.retryable) {
      this.fail('terminal', failure);
      return;
    }
    if (this.attempts >= this.maxAttempts) {
      this.enterCooldown(failure);
      return;
    }
    const baseDelay = this.retryDelaysMs[Math.min(this.attempts - 1, this.retryDelaysMs.length - 1)] ?? 0;
    const delay = Math.round(baseDelay * (0.5 + this.random() * 0.5));
    this.retryTimer = this.schedule(() => {
      this.retryTimer = null;
      if (this.isCurrent(epoch)) this.maybeAttempt();
    }, delay);
  }

  // The failed transition carries the reason, so a failure report says why
  // recovery gave up instead of "unknown_error".
  fail(result: 'terminal' | 'exhausted', failure: { status?: number; code?: string } = {}): void {
    this.clearRetryTimer();
    this.failedAppEpoch = this.appEpoch;
    this.phase = 'failed';
    this.emit('recovery_failed', result, this.attempts, failure.status ?? 0, failure.code ?? 'unknown_error');
  }

  enterCooldown(failure: { status?: number; code?: string } = {}): void {
    this.fail('exhausted', failure);
    this.cooldownComplete = false;
    this.meaningfulRearm = false;
    this.rearmNeedsSnapshotRequest = false;
    this.rearmSnapshotReady = false;
    const failedEpoch = this.epoch;
    const cooldownDelay = Math.min(this.cooldownMs * 8, this.cooldownMs * 2 ** this.cooldownCycles);
    this.cooldownCycles += 1;
    this.cooldownTimer = this.schedule(() => {
      this.cooldownTimer = null;
      if (!this.isCurrent(failedEpoch)) return;
      this.cooldownComplete = true;
      if (this.isNetworkOnline && this.appConnected && this.replacementRequired) {
        this.markMeaningfulRearm('cooldown_probe', true);
        return;
      }
      this.tryRearm();
    }, cooldownDelay);
  }

  markMeaningfulRearm(trigger: string, requestSnapshot: boolean): void {
    this.meaningfulRearm = true;
    this.rearmNeedsSnapshotRequest ||= requestSnapshot;
    this.emit(trigger, 'rearm_pending');
    this.tryRearm();
  }

  tryRearm(): void {
    if (this.phase !== 'failed' || !this.cooldownComplete || !this.meaningfulRearm) return;
    this.effectGeneration += 1;
    this.epoch += 1;
    this.startedAt = this.now();
    this.attempts = 0;
    this.snapshotReady = this.rearmSnapshotReady;
    this.cooldownComplete = false;
    this.meaningfulRearm = false;
    const requestSnapshot = this.rearmNeedsSnapshotRequest;
    this.rearmNeedsSnapshotRequest = false;
    this.rearmSnapshotReady = false;
    this.setPhase('waiting-app-snapshot', 'rearmed', 'accepted');
    if (this.snapshotReady) this.maybeAttempt();
    else if (requestSnapshot) this.requestSnapshot();
  }

  setPhase(phase: RecoveryPhase, trigger: string, result = 'transition'): void {
    if (this.phase === phase && result === 'transition') return;
    this.phase = phase;
    this.emit(trigger, result);
  }

  emit(trigger: string, result: string, attempt: number = this.attempts, status = 0, code = 'unknown_error'): void {
    this.onTransition(
      Object.freeze({
        epoch: this.epoch,
        appEpoch: this.appEpoch,
        trigger,
        phase: this.phase,
        attempt,
        elapsed: elapsedBucket(Math.max(0, this.now() - this.startedAt)),
        status,
        code: sanitizeRecoveryCode(code),
        result
      })
    );
  }

  clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      this.cancelTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  cancelAllTimers(): void {
    this.clearRetryTimer();
    if (this.cooldownTimer !== null) {
      this.cancelTimer(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }
}
