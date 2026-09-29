// System audio for a desktop screen share: the desktop app's native helper
// streams PCM chunks, which an AudioWorklet turns into a MediaStream track the
// share publishes. The helper reports its format first; a capture that never
// hears it gives up after three seconds.

import { DESKTOP_AUDIO_SOURCE_WORKLET_URL } from '../core/config';
import { state } from '../core/state.svelte';
import type { DesktopAudioCapture } from '../core/types';
import { disconnectAudioNode } from '../core/utils';
import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:screen-capture');

export function hasNativeDesktopSafeAudio(): boolean {
  const bridge = window.voiceRoomDesktopAudio;
  return Boolean(
    typeof bridge?.startSafeSystem === 'function' &&
    typeof bridge?.stop === 'function' &&
    typeof bridge?.onData === 'function' &&
    typeof bridge?.onEvent === 'function'
  );
}

export async function startDesktopSafeScreenAudioCapture(): Promise<DesktopAudioCapture> {
  stopLocalScreenAudioCapture();

  let sessionId = '';
  let formatEvent: { channels?: number; sampleRate?: number } | null = null;
  let resolveFormat!: (event: { channels?: number; sampleRate?: number }) => void;
  let rejectFormat!: (error: Error) => void;
  const formatPromise = new Promise<{ channels?: number; sampleRate?: number }>((resolve, reject) => {
    resolveFormat = resolve;
    rejectFormat = reject;
  });
  const formatTimer = window.setTimeout(() => {
    rejectFormat(new Error('Native audio helper did not report audio format.'));
  }, 3000);

  const removeEventListener = window.voiceRoomDesktopAudio!.onEvent(({ sessionId: payloadSessionId, event }) => {
    if (sessionId && payloadSessionId !== sessionId) return;
    if (event?.event === 'format') {
      formatEvent = event;
      resolveFormat(event);
      return;
    }
    if (event?.event === 'error') {
      rejectFormat(new Error(event.message || 'Native audio helper failed.'));
    }
  });

  try {
    const audioSession = await window.voiceRoomDesktopAudio!.startSafeSystem({
      mode: 'safe-system'
    });
    sessionId = audioSession.sessionId;
    const format = formatEvent || (await formatPromise);
    window.clearTimeout(formatTimer);
    return await createDesktopSafeAudioTrack({
      format,
      removeEventListener,
      sessionId
    });
  } catch (error) {
    window.clearTimeout(formatTimer);
    removeEventListener();
    if (sessionId) await stopDesktopAudioSession(sessionId);
    throw error;
  }
}

async function createDesktopSafeAudioTrack({
  format,
  removeEventListener,
  sessionId
}: {
  format: { channels?: number; sampleRate?: number };
  removeEventListener: () => void;
  sessionId: string;
}): Promise<DesktopAudioCapture> {
  const channels = Math.max(1, Math.min(8, Number(format.channels) || 2));
  const sampleRate = Math.max(8000, Math.min(192000, Number(format.sampleRate) || 48000));
  const audioContext = createDesktopAudioContext(sampleRate);
  try {
    await audioContext.audioWorklet.addModule(DESKTOP_AUDIO_SOURCE_WORKLET_URL);
  } catch (error) {
    audioContext.close().catch(() => {});
    throw error;
  }

  const source = new AudioWorkletNode(audioContext, 'voice-room-desktop-audio-source', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    processorOptions: { channels }
  });
  const destination = audioContext.createMediaStreamDestination();
  source.connect(destination);

  const removeDataListener = window.voiceRoomDesktopAudio!.onData((payload) => {
    if (payload.sessionId !== sessionId) return;
    const samples = getDesktopPcmSamples(payload.chunk);
    if (!samples.length) return;
    source.port.postMessage({ samples, type: 'samples' }, [samples.buffer]);
  });

  const [track] = destination.stream.getAudioTracks();
  track.contentHint = 'music';

  const capture: DesktopAudioCapture = {
    audioContext,
    cleanup: null,
    destination,
    removeDataListener,
    removeEventListener,
    sessionId,
    source,
    track
  };
  capture.cleanup = () => stopDesktopSafeAudioCapture(capture);
  track.addEventListener('ended', capture.cleanup, { once: true });
  return capture;
}

function createDesktopAudioContext(sampleRate: number): AudioContext {
  try {
    return new AudioContext({ sampleRate });
  } catch {
    return new AudioContext();
  }
}

export function getDesktopPcmSamples(chunk: Uint8Array | ArrayBuffer | null | undefined): Float32Array<ArrayBuffer> {
  if (!chunk) return new Float32Array();

  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  const byteLength = bytes.byteLength - (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT);
  if (byteLength <= 0) return new Float32Array();

  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + byteLength) as ArrayBuffer);
}

export function stopLocalScreenAudioCapture(): void {
  const capture = state.localScreenAudioCapture;
  state.localScreenAudioCapture = null;
  stopDesktopSafeAudioCapture(capture);
}

function stopDesktopSafeAudioCapture(capture: DesktopAudioCapture | null): void {
  if (!capture) return;

  if (capture.cleanup) capture.track?.removeEventListener?.('ended', capture.cleanup);
  capture.removeDataListener?.();
  capture.removeEventListener?.();
  disconnectAudioNode(capture.source);
  disconnectAudioNode(capture.destination);
  capture.audioContext?.close?.().catch(() => {});
  stopDesktopAudioSession(capture.sessionId).catch((error) => {
    log.warn('native desktop audio stop failed', errorContext(error));
  });
}

async function stopDesktopAudioSession(sessionId: string): Promise<void> {
  if (!sessionId || !window.voiceRoomDesktopAudio?.stop) return;
  await window.voiceRoomDesktopAudio.stop(sessionId);
}
