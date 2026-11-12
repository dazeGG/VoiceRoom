import {
  REPLACEMENT_ABANDONED,
  RealtimeRecoveryController,
  classifyRecoveryFailure,
  type RecoveryTransition,
  type ReplacementOutcome
} from './realtime-recovery';
import { requestActiveVoiceResync, setActiveVoiceResyncFailureHandler } from '@/entities/room/room-realtime';

import { createLogger, reportClientLogs, type LogContext } from '@/shared/log';

const log = createLogger('room:recovery');

export type RoomRecoveryLiveKitAdapter = {
  attemptFreshReplacement: (context: { epoch: number; attempt: number }) => Promise<ReplacementOutcome>;
};

let controller: RealtimeRecoveryController | null = null;
let liveKitAdapter: RoomRecoveryLiveKitAdapter | null = null;
const transitionHandlers = new Set<(event: RecoveryTransition) => void>();
const optionalRequests = new WeakMap<Promise<boolean>, { controller: RealtimeRecoveryController; epoch: number }>();

// The recovery state machine already emits a flat record of primitives per
// transition, which is exactly the trail needed to tell a brief blip from a
// call that never came back. Every transition is buffered; only the terminal
// failure is raised and reported, so the ordinary reconnect stays quiet.
function logTransition(event: RecoveryTransition): void {
  const context: LogContext = {
    epoch: event.epoch,
    trigger: event.trigger,
    phase: event.phase,
    attempt: event.attempt,
    elapsed: event.elapsed,
    status: event.status,
    code: event.code,
    result: event.result
  };

  if (event.phase === 'failed') {
    log.warn('room recovery failed', context);
    void reportClientLogs(`room recovery failed: ${context.code}`);
  } else {
    log.debug('room recovery transition', context);
  }

  for (const handler of transitionHandlers) handler(event);
}

export function subscribeRoomRecoveryTransitions(handler: (event: RecoveryTransition) => void): () => void {
  transitionHandlers.add(handler);
  return () => transitionHandlers.delete(handler);
}

/** Resolves once the recovery under way is over (healthy, failed or cancelled); null when none is running. */
export function roomRecoverySettled(): Promise<void> | null {
  const current = controller;
  if (!current) return null;
  const isOver = (phase: RecoveryTransition['phase']) =>
    phase === 'idle' || phase === 'healthy' || phase === 'failed' || phase === 'cancelled';
  if (isOver(current.getSnapshot().phase)) return null;
  return new Promise((resolve) => {
    const unsubscribe = subscribeRoomRecoveryTransitions(({ phase }) => {
      if (!isOver(phase)) return;
      unsubscribe();
      resolve();
    });
  });
}

export function setRoomRecoveryLiveKitAdapter(adapter: RoomRecoveryLiveKitAdapter | null): void {
  liveKitAdapter = adapter;
}

export function startRoomRecovery(appEpoch: number, appConnected: boolean): number {
  controller?.cancel();
  controller = new RealtimeRecoveryController({
    attemptReplacement: async (context: { epoch: number; attempt: number }) => {
      if (!liveKitAdapter) return { retryable: false, code: 'unknown_error' };
      try {
        return await liveKitAdapter.attemptFreshReplacement(context);
      } catch (error) {
        return classifyRecoveryFailure(error);
      }
    },
    requestAppSnapshot: ({ epoch, appEpoch: currentAppEpoch }: { epoch: number; appEpoch: number }) => {
      return requestActiveVoiceResync(epoch, currentAppEpoch);
    },
    onTransition: logTransition
  });
  setActiveVoiceResyncFailureHandler(({ code }) => controller?.appSnapshotRequestFailed({ code }));
  return controller.activate({ appEpoch, appConnected });
}

export function cancelRoomRecovery(): void {
  setActiveVoiceResyncFailureHandler(null);
  controller?.cancel();
  controller = null;
}

export function notifyRoomAppConnection(connected: boolean, appEpoch: number): void {
  if (connected) controller?.appWsRestored(appEpoch);
  else controller?.appWsLost(appEpoch);
}

export function notifyRoomSnapshotApplied(input: {
  appEpoch: number;
  active: boolean;
  hasLocalPeer: boolean;
}): boolean {
  return controller?.appSnapshotApplied(input) ?? false;
}

export function notifyRoomNetworkOffline(): void {
  controller?.networkOffline();
}

export function notifyRoomNetworkOnline(): void {
  controller?.networkOnline();
}

export function notifyLiveKitReconnecting(): void {
  controller?.livekitReconnecting();
}

export function notifyLiveKitReconciled(): void {
  controller?.livekitReconciled();
}

export function notifyLiveKitDisconnected(): void {
  controller?.livekitDisconnected();
}

/**
 * Asks for a new LiveKit connection although the current one stands. Null when a
 * recovery is running or nothing is joined; otherwise answers once it is over,
 * whether the connection was replaced.
 */
export function requestLiveKitReplacement(): Promise<boolean> | null {
  const current = controller;
  if (!current) return null;
  let answer = (_replaced: boolean) => {};
  const replaced = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  // Listening first: an attempt can be abandoned before the request returns.
  const unsubscribe = subscribeRoomRecoveryTransitions(({ phase, trigger }) => {
    const gaveUp = trigger === REPLACEMENT_ABANDONED || phase === 'failed' || phase === 'cancelled';
    if (!gaveUp && phase !== 'healthy') return;
    unsubscribe();
    answer(!gaveUp);
  });
  if (current.requestLiveKitReplacement()) {
    optionalRequests.set(replaced, { controller: current, epoch: current.getSnapshot().epoch });
    return replaced;
  }
  unsubscribe();
  return null;
}

/** A timed-out microphone action cannot leave its optional replacement alive. */
export function abandonOptionalLiveKitReplacement(request: Promise<boolean>): boolean {
  const owner = optionalRequests.get(request);
  if (!owner || controller !== owner.controller) return false;
  optionalRequests.delete(request);
  return owner.controller.abandonOptionalReplacement(owner.epoch);
}

export function isCurrentRoomRecoveryEpoch(epoch: number): boolean {
  return controller?.isCurrent(epoch) ?? false;
}
