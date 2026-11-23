import type { ProcessingRelief } from '@voiceroom/shared/contracts/rooms';
import { state } from '../core/room-runtime.store';
import { getMicrophoneCaptureDiagnostics } from '../services/microphone-service';
import { getMicrophoneCallGeneration } from '../ui/devices';
import { recordCpuRelief } from './call-quality';
import { noteProcessingRelief } from './capture-diagnostics';

/** An asynchronous relief attempt only belongs to the call that started it. */
export function createProcessingReliefRecorder(): (result: ProcessingRelief) => void {
  const generation = getMicrophoneCallGeneration();
  const { roomId, sessionToken } = state;
  const startedAt = performance.now();
  return (result) => {
    if (
      !state.joined ||
      getMicrophoneCallGeneration() !== generation ||
      state.roomId !== roomId ||
      state.sessionToken !== sessionToken
    )
      return;
    if (result.outcome === 'applied') recordCpuRelief();
    noteProcessingRelief({
      ...result,
      generation,
      requestedMode: result.kind === 'noise' ? 'browser' : null,
      actualMode: getMicrophoneCaptureDiagnostics().actualMode,
      durationMs: performance.now() - startedAt
    });
  };
}
