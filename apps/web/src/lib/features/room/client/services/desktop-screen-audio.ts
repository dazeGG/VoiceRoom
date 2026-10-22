// System audio for a desktop screen share: the desktop app's native helper
// streams PCM chunks, which an AudioWorklet turns into a MediaStream track the
// share publishes. The helper reports its format first; a capture that never
// hears it gives up after three seconds.
//
// The desktop app restarts a helper that dies mid-stream under the same session,
// so the track survives short gaps. A non-zero 'exit' means it gave up: the
// share keeps its video but has lost its sound, and the lost-audio handler is told.

import { DESKTOP_AUDIO_SOURCE_WORKLET_URL } from '../core/config';
import { state } from '../core/state.svelte';
import type { DesktopAudioCapture } from '../core/types';
import { disconnectAudioNode } from '../core/utils';
import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:screen-capture');

type DesktopScreenAudioLostHandler = () => void;
let audioLostHandler: DesktopScreenAudioLostHandler | null = null;

export function onDesktopScreenAudioLost(handler: DesktopScreenAudioLostHandler): () => void {
  audioLostHandler = handler;
  return () => {
    if (audioLostHandler === handler) audioLostHandler = null;
  };
}

function handleLiveSessionEvent(
  sessionId: string,
  event: { event?: string; attempt?: number; delayMs?: number; code?: number | null; signal?: string | null }
): void {
  if (state.localScreenAudioCapture?.sessionId !== sessionId) return;
  if (event.event === 'restarting') {
    log.warn('native desktop audio restarting', { attempt: event.attempt ?? null, delayMs: event.delayMs ?? null });
    return;
  }
  if (event.event !== 'exit' || event.code === 0) return;
  log.error('native desktop audio lost', { code: event.code ?? null, signal: event.signal ?? null });
  audioLostHandler?.();
}

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
  const bridge = window.voiceRoomDesktopAudio;
  if (!bridge) throw new Error('Native audio helper is unavailable.');

  let sessionId = '';
  let formatEvent: { channels?: number; sampleRate?: number } | null = null;
  // Both are replaced at once: the Promise executor runs synchronously.
  let resolveFormat: (event: { channels?: number; sampleRate?: number }) => void = () => {};
  let rejectFormat: (error: Error) => void = () => {};
  const formatPromise = new Promise<{ channels?: number; sampleRate?: number }>((resolve, reject) => {
    resolveFormat = resolve;
    rejectFormat = reject;
  });
  const formatTimer = window.setTimeout(() => {
    rejectFormat(new Error('Native audio helper did not report audio format.'));
  }, 3000);

  const removeEventListener = bridge.onEvent(({ sessionId: payloadSessionId, event }) => {
    if (sessionId && payloadSessionId !== sessionId) return;
    if (formatEvent && event) {
      handleLiveSessionEvent(payloadSessionId, event);
      return;
    }
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
    const audioSession = await bridge.startSafeSystem({
      mode: 'safe-system'
    });
    sessionId = audioSession.sessionId;
    const format = formatEvent || (await formatPromise);
    window.clearTimeout(formatTimer);
    return await createDesktopSafeAudioTrack({
      bridge,
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
  bridge,
  format,
  removeEventListener,
  sessionId
}: {
  bridge: NonNullable<Window['voiceRoomDesktopAudio']>;
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

  const removeDataListener = bridge.onData((payload) => {
    if (payload.sessionId !== sessionId) return;
    const samples = getDesktopPcmSamples(payload.chunk);
    if (!samples.length) return;
    source.port.postMessage({ samples, type: 'samples' }, [samples.buffer]);
  });

  const [track] = destination.stream.getAudioTracks();
  if (!track) {
    removeDataListener();
    audioContext.close().catch(() => {});
    throw new Error('desktop audio destination has no track');
  }
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

  const copy = new Uint8Array(byteLength);
  copy.set(bytes.subarray(0, byteLength));
  return new Float32Array(copy.buffer);
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
  stopDesktopAudioSession(capture.sessionId).catch((error: unknown) => {
    log.warn('native desktop audio stop failed', errorContext(error));
  });
}

async function stopDesktopAudioSession(sessionId: string): Promise<void> {
  if (!sessionId || !window.voiceRoomDesktopAudio?.stop) return;
  await window.voiceRoomDesktopAudio.stop(sessionId);
}
