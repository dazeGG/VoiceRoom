import { RealtimeRecoveryController, classifyRecoveryFailure } from './realtime-recovery.js';
import { requestActiveVoiceResync } from '$lib/features/home/model/room-realtime';

export type RecoveryAttemptOutcome = {
  ok?: boolean;
  retryable?: boolean;
  status?: number;
  code?: string;
};

export type RoomRecoveryLiveKitAdapter = {
  attemptFreshReplacement: (context: { epoch: number; attempt: number }) => Promise<RecoveryAttemptOutcome>;
};

let controller: RealtimeRecoveryController | null = null;
let liveKitAdapter: RoomRecoveryLiveKitAdapter | null = null;
const transitionHandlers = new Set<(event: Readonly<Record<string, unknown>>) => void>();

function logTransition(event: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.debug('room_recovery_transition', event);
  for (const handler of transitionHandlers) handler(event);
}

export function subscribeRoomRecoveryTransitions(
  handler: (event: Readonly<Record<string, unknown>>) => void
): () => void {
  transitionHandlers.add(handler);
  return () => transitionHandlers.delete(handler);
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
      requestActiveVoiceResync(epoch, currentAppEpoch);
    },
    onTransition: logTransition
  });
  return controller.activate({ appEpoch, appConnected });
}

export function cancelRoomRecovery(): void {
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

export function isCurrentRoomRecoveryEpoch(epoch: number): boolean {
  return controller?.isCurrent(epoch) ?? false;
}

export function getRoomRecoverySnapshot(): Readonly<{
  epoch: number;
  phase: string;
  appEpoch: number;
  snapshotReady: boolean;
  livekitReady: boolean;
  attempts: number;
  inFlight: boolean;
}> | null {
  return controller?.getSnapshot() ?? null;
}
