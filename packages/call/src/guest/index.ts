import { computed, readonly, ref, shallowRef, type Ref } from 'vue';
import type { RoomCapabilities } from '@voiceroom/shared/contracts/rooms';
import { callPageState } from '../engine/core/call-page.store';
import { state } from '../engine/core/room-runtime.store';
import { cleanDisplayName } from '../engine/core/utils';
import { mountGuestRoomClient } from '../engine/main';
import { joinRoom } from '../engine/room/room';

interface GuestRoomStatus {
  readonly roomId: string;
  readonly capabilities: RoomCapabilities;
  readonly peers: number;
}

type GuestPhase = 'checking' | 'name' | 'joining' | 'call' | 'reconnecting' | 'left' | 'not-found' | 'error' | 'closed';
type GuestFailure = 'status' | 'name-required' | 'join' | 'closed';

interface GuestJoinOptions {
  roomId: string;
  status: (roomId: string) => Promise<GuestRoomStatus | null>;
  setDisplayName: (displayName: string) => void;
  admissionCapabilities?: Readonly<Ref<RoomCapabilities | null>>;
}

/** Owns one guest entry. The engine still owns roster, media, and recovery. */
export function createGuestJoinController(options: GuestJoinOptions) {
  const step = ref<Exclude<GuestPhase, 'reconnecting' | 'closed'>>('checking');
  const room = shallowRef<GuestRoomStatus | null>(null);
  const issue = ref<GuestFailure | null>(null);
  let checkedAt = 0;
  let generation = 0;
  let disposed = false;
  let unmount: (() => void) | null = null;

  const phase = computed<GuestPhase>(() => {
    if (step.value !== 'call') return step.value;
    if (callPageState().screen === 'not-found') return 'not-found';
    if (!state.joined) return 'closed';
    if (
      state.serverConnection !== 'connected' ||
      state.voiceConnection === 'reconnecting' ||
      state.voiceConnection === 'signal-reconnecting'
    )
      return 'reconnecting';
    return 'call';
  });

  const failure = computed<GuestFailure | null>(() => (phase.value === 'closed' ? 'closed' : issue.value));
  const capabilities = computed<RoomCapabilities | null>(() => {
    const status = room.value?.capabilities;
    if (!status) return null;
    const admission = options.admissionCapabilities?.value;
    if (!admission) return status;
    return {
      camera: status.camera && admission.camera,
      screenShare: status.screenShare && admission.screenShare,
      chat: status.chat === admission.chat ? status.chat : 'none',
      maxPeers: Math.min(status.maxPeers, admission.maxPeers)
    };
  });

  function stopRuntime(): void {
    const stop = unmount;
    unmount = null;
    stop?.();
  }

  async function check(): Promise<void> {
    if (disposed || phase.value === 'call' || phase.value === 'reconnecting' || step.value === 'joining') return;
    const current = ++generation;
    stopRuntime();
    step.value = 'checking';
    room.value = null;
    issue.value = null;
    try {
      const status = await options.status(options.roomId);
      if (current !== generation) return;
      room.value = status;
      checkedAt = Date.now();
      step.value = status ? 'name' : 'not-found';
    } catch {
      if (current !== generation) return;
      issue.value = 'status';
      step.value = 'error';
    }
  }

  async function join(rawName: string): Promise<void> {
    if (disposed || step.value !== 'name' || !room.value) return;
    const name = cleanDisplayName(rawName);
    if (!name) {
      issue.value = 'name-required';
      return;
    }
    const current = ++generation;
    step.value = 'joining';
    issue.value = null;
    try {
      options.setDisplayName(name);
      unmount = mountGuestRoomClient(room.value.roomId, name, checkedAt);
      await joinRoom();
      if (current !== generation) return;
      if (state.joined) {
        step.value = 'call';
        return;
      }
      if (callPageState().screen === 'not-found') {
        stopRuntime();
        room.value = null;
        step.value = 'not-found';
        return;
      }
    } catch {
      if (current !== generation) return;
    }
    stopRuntime();
    issue.value = 'join';
    step.value = 'name';
  }

  function leave(): void {
    if (disposed) return;
    generation += 1;
    stopRuntime();
    issue.value = null;
    step.value = 'left';
  }

  function dispose(): void {
    if (disposed) return;
    leave();
    disposed = true;
  }

  return { phase, room: readonly(room), failure, capabilities, check, join, leave, dispose };
}

export { createGuestTransport } from './transport';
