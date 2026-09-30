import crypto from 'node:crypto';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;
const DEFAULT_IDLE_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export type Lease = Readonly<{ identity: string; ownerId: string; fencingToken: number; expiresAt: unknown }>;

export type FenceGuard = Readonly<{
  lease: Lease;
  signal: AbortSignal;
  assertOwned(): number;
  isOwned(): boolean;
  markLost(): void;
}>;

type LeaseRequest = { identity: string; leaseMs: number; ownerId: string; signal: AbortSignal };
type LeaseReference = { fencingToken: number; identity: string; ownerId: string };
type AcquireResult =
  | { acquired?: boolean; fencingToken?: unknown; fencing_token?: unknown; expiresAt?: unknown; expires_at?: unknown }
  | null
  | undefined;
type Heartbeat = { identity: string; ownerId: string; fencingToken: number; ready: boolean };
type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
type RuntimeLogger = { warn(...args: unknown[]): void; error(...args: unknown[]): void };

class LeaseLostError extends Error {
  declare code: string;

  constructor(message = 'Fenced lease ownership was lost') {
    super(message);
    this.name = 'LeaseLostError';
    this.code = 'LEASE_LOST';
  }
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Lease runtime stopped') as Error & { code?: string };
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, ms));
    function finish() {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function boundedBackoff(
  attempt: unknown,
  {
    baseMs = DEFAULT_IDLE_MS,
    maxMs = DEFAULT_MAX_BACKOFF_MS,
    jitter = 0
  }: { baseMs?: number; maxMs?: number; jitter?: unknown } = {}
): number {
  const exponent = Math.max(0, Math.min(20, Number(attempt) || 0));
  const bounded = Math.min(Math.max(1, maxMs), Math.max(1, baseMs) * 2 ** exponent);
  const normalizedJitter = Math.max(0, Math.min(1, Number(jitter) || 0));
  if (!normalizedJitter) return bounded;
  const spread = bounded * normalizedJitter;
  return Math.max(1, Math.round(bounded - spread + Math.random() * spread * 2));
}

function createFenceGuard({ lease, signal }: { lease: Lease; signal: AbortSignal }): FenceGuard {
  let lost = false;
  return Object.freeze({
    lease,
    signal,
    assertOwned() {
      if (lost || signal.aborted) throw new LeaseLostError();
      return lease.fencingToken;
    },
    isOwned() {
      return !lost && !signal.aborted;
    },
    markLost() {
      lost = true;
    }
  });
}

function normalizeLease(value: AcquireResult, identity: string, ownerId: string): Lease | null {
  if (!value || value.acquired === false) return null;
  const fencingToken = Number(value.fencingToken ?? value.fencing_token);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new TypeError('Lease adapter must return a positive integer fencingToken');
  }
  return Object.freeze({
    identity,
    ownerId,
    fencingToken,
    expiresAt: value.expiresAt ?? value.expires_at ?? null
  });
}

function createLeaseRuntime({
  acquire,
  identity,
  idleMs = DEFAULT_IDLE_MS,
  jitter = 0,
  leaseMs = DEFAULT_LEASE_MS,
  logger = createLogger({ name: 'worker' }),
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  onHeartbeat = () => {},
  ownerId = crypto.randomUUID(),
  release = async () => {},
  renew,
  renewMs = DEFAULT_RENEW_MS,
  run,
  sleep = delay
}: {
  acquire?: (request: LeaseRequest) => Promise<AcquireResult> | AcquireResult;
  identity?: string;
  idleMs?: number;
  jitter?: unknown;
  leaseMs?: number;
  logger?: RuntimeLogger;
  maxBackoffMs?: number;
  onHeartbeat?: (heartbeat: Heartbeat) => void;
  ownerId?: string;
  release?: (lease: LeaseReference) => Promise<unknown>;
  renew?: (
    request: LeaseReference & { leaseMs: number; signal: AbortSignal }
  ) => Promise<{ renewed?: boolean } | null | undefined> | { renewed?: boolean } | null | undefined;
  renewMs?: number;
  run?: (guard: FenceGuard) => Promise<unknown> | unknown;
  sleep?: Sleep;
} = {}) {
  if (!identity || typeof identity !== 'string') throw new TypeError('Lease identity is required');
  if (typeof acquire !== 'function') throw new TypeError('Lease acquire adapter is required');
  if (typeof renew !== 'function') throw new TypeError('Lease renew adapter is required');
  if (typeof run !== 'function') throw new TypeError('Lease work callback is required');
  if (!(renewMs > 0 && renewMs < leaseMs)) throw new TypeError('renewMs must be positive and less than leaseMs');
  const leaseIdentity = identity;
  const acquireLease = acquire;
  const renewLease = renew;
  const work = run;

  const runtimeController = new AbortController();
  let loopPromise: Promise<void> | null = null;
  let active: { guard: FenceGuard; lease: Lease } | null = null;

  async function holdLease(lease: Lease): Promise<void> {
    const workController = new AbortController();
    const forwardStop = () => workController.abort(abortError(runtimeController.signal));
    runtimeController.signal.addEventListener('abort', forwardStop, { once: true });
    const guard = createFenceGuard({ lease, signal: workController.signal });
    active = { guard, lease };

    const renewal = (async () => {
      try {
        while (!workController.signal.aborted) {
          await sleep(renewMs, workController.signal);
          guard.assertOwned();
          const result = await renewLease({
            fencingToken: lease.fencingToken,
            identity: leaseIdentity,
            leaseMs,
            ownerId,
            signal: workController.signal
          });
          if (!result || result.renewed === false) throw new LeaseLostError();
          onHeartbeat({ identity: leaseIdentity, ownerId, fencingToken: lease.fencingToken, ready: true });
        }
      } catch (error) {
        if (!workController.signal.aborted) {
          guard.markLost();
          workController.abort(error instanceof LeaseLostError ? error : new LeaseLostError());
        }
      }
    })();

    try {
      await work(guard);
      guard.assertOwned();
    } finally {
      workController.abort();
      await renewal.catch(() => {});
      runtimeController.signal.removeEventListener('abort', forwardStop);
      active = null;
      onHeartbeat({ identity: leaseIdentity, ownerId, fencingToken: lease.fencingToken, ready: false });
      await release({
        fencingToken: lease.fencingToken,
        identity: leaseIdentity,
        ownerId
      }).catch((error: unknown) =>
        logger.warn(
          { evt: LOG_EVENTS.WORKER_HEARTBEAT_FAILED, identity: leaseIdentity, stage: 'release', err: error },
          'unable to release a fenced lease'
        )
      );
    }
  }

  async function loop(): Promise<void> {
    let failures = 0;
    while (!runtimeController.signal.aborted) {
      try {
        const lease = normalizeLease(
          await acquireLease({
            identity: leaseIdentity,
            leaseMs,
            ownerId,
            signal: runtimeController.signal
          }),
          leaseIdentity,
          ownerId
        );
        if (!lease) {
          await sleep(
            boundedBackoff(failures, { baseMs: idleMs, maxMs: maxBackoffMs, jitter }),
            runtimeController.signal
          );
          failures = Math.min(failures + 1, 20);
          continue;
        }
        failures = 0;
        await holdLease(lease);
      } catch (error) {
        if (runtimeController.signal.aborted) break;
        if (!(error instanceof LeaseLostError))
          logger.error(
            { evt: LOG_EVENTS.WORKER_FAILED, identity: leaseIdentity, stage: 'iteration', err: error },
            'fenced lease iteration failed'
          );
        failures = Math.min(failures + 1, 20);
        await sleep(
          boundedBackoff(failures, { baseMs: idleMs, maxMs: maxBackoffMs, jitter }),
          runtimeController.signal
        ).catch(() => {});
      }
    }
  }

  return Object.freeze({
    identity: leaseIdentity,
    ownerId,
    get activeLease(): Lease | null {
      return active?.lease || null;
    },
    start(): Promise<void> {
      if (!loopPromise)
        loopPromise = loop().finally(() => {
          loopPromise = null;
        });
      return loopPromise;
    },
    async stop(): Promise<void> {
      runtimeController.abort();
      active?.guard.markLost();
      await loopPromise?.catch(() => {});
    }
  });
}

export type LeaseRuntime = ReturnType<typeof createLeaseRuntime>;

export { LeaseLostError, boundedBackoff, createLeaseRuntime };
