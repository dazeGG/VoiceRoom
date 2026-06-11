import { DESKTOP_AUDIO_SOURCE_WORKLET_URL, DEFAULT_SCREEN_PROFILE_ID } from '../core/config';
import { elements } from '../ui/dom';
import { state } from '../core/state';
import { showToast } from '../ui/toast';
import { createScreenProfileId, getScreenProfile } from './profiles';
import { createAbortError, disconnectAudioNode, isCaptureCancelled } from '../core/utils';
import { setLocalAppAudioSuppressed } from './playback';
import type { DesktopAudioCapture, DesktopCaptureSource, DesktopPickerSelection, ScreenProfile } from '../core/types';

interface CaptureAttemptDetail {
  error: unknown;
  method: string;
}

type CaptureError = Error & { captureAttemptDetails?: CaptureAttemptDetail[] };

export interface ScreenShareCapture {
  profile: ScreenProfile;
  stream: MediaStream;
}

export function wantsScreenShareAudio(): boolean {
  return true;
}

export async function openScreenShare(profile: ScreenProfile): Promise<ScreenShareCapture> {
  if (hasDesktopOpenPicker()) {
    return openDesktopScreenShareWithPicker(profile);
  }

  if (hasLegacyDesktopCapture()) {
    return {
      profile,
      stream: await openDesktopScreenShare(profile)
    };
  }

  if (isDesktopApp()) {
    throw new Error('Desktop-оболочка не загрузила модуль выбора экрана. Перезапустите приложение из новой сборки.');
  }

  return {
    profile,
    stream: await openBrowserScreenShare(profile)
  };
}

function hasDesktopOpenPicker(): boolean {
  return typeof window.voiceRoomDesktopCapture?.openPicker === 'function';
}

function hasLegacyDesktopCapture(): boolean {
  return Boolean(window.voiceRoomDesktopCapture?.getSources);
}

export function isDesktopApp(): boolean {
  return Boolean(window.voiceRoomRuntime?.isDesktop);
}

async function openBrowserScreenShare(profile: ScreenProfile): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Браузер не поддерживает демонстрацию экрана. Нужен HTTPS или localhost.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(createBrowserDisplayMediaConstraints(profile, {
      audio: wantsScreenShareAudio(),
      suppressLocalAudioPlayback: false
    }));
  } catch (error) {
    if ((error as Error)?.name !== 'TypeError') throw error;
    stream = await navigator.mediaDevices.getDisplayMedia(createBrowserDisplayMediaConstraints(profile, {
      audio: wantsScreenShareAudio(),
      includeAudioHints: false,
      suppressLocalAudioPlayback: false
    }));
  }

  await applyScreenCaptureProfile(stream, profile);
  return stream;
}

function createBrowserDisplayMediaConstraints(
  profile: ScreenProfile,
  options: { audio?: boolean; includeAudioHints?: boolean; suppressLocalAudioPlayback?: boolean } = {}
): DisplayMediaStreamOptions {
  const {
    audio = true,
    includeAudioHints = true,
    suppressLocalAudioPlayback = false
  } = options;
  const video = {
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
    height: { ideal: profile.height, max: profile.height },
    width: { ideal: profile.width, max: profile.width }
  };

  if (!audio) {
    return {
      audio: false,
      video
    };
  }

  return {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback
    },
    video,
    ...(includeAudioHints
      ? {
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: 'include',
          windowAudio: 'system'
        }
      : {})
  } as DisplayMediaStreamOptions;
}

async function openDesktopScreenShare(profile: ScreenProfile): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia && !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Desktop-оболочка не дала доступ к захвату экрана.');
  }

  const source = await selectDesktopCaptureSource();
  const withAudio = wantsScreenShareAudio();
  let stream: MediaStream;
  let audioCaptureError: unknown = null;

  if (!withAudio) {
    stream = await openDesktopStream(source.id, profile, { audio: false, audioMode: 'none' });
    await applyScreenCaptureProfile(stream, profile);
    return stream;
  }

  if (hasNativeDesktopSafeAudio()) {
    stream = await openDesktopStream(source.id, profile, { audio: false, audioMode: 'safe-system' });
    try {
      const audioCapture = await startDesktopSafeScreenAudioCapture();
      stream.addTrack(audioCapture.track);
      state.localScreenAudioCapture = audioCapture;
    } catch (error) {
      console.warn('Native desktop audio capture failed, continuing without stream audio', error);
      showToast('Стрим запущен без звука: безопасный системный звук недоступен', {
        duration: 9000,
        variant: 'error'
      });
    }

    await applyScreenCaptureProfile(stream, profile);
    return stream;
  }

  if (isDesktopApp()) {
    stream = await openDesktopStream(source.id, profile, { audio: false, audioMode: 'safe-system' });
    showToast('Стрим запущен без звука: в этой сборке нет безопасного системного звука', {
      duration: 9000,
      variant: 'error'
    });
    await applyScreenCaptureProfile(stream, profile);
    return stream;
  }

  try {
    stream = await openDesktopStream(source.id, profile, { audio: true, audioMode: 'loopback' });
  } catch (error) {
    if (isCaptureCancelled(error)) {
      setLocalAppAudioSuppressed(false);
      throw error;
    }
    audioCaptureError = error;
    console.warn('Desktop audio capture unavailable, retrying without audio', error);
    try {
      stream = await openDesktopStream(source.id, profile, { audio: false, audioMode: 'none' });
    } catch (videoError) {
      throw mergeDesktopCaptureErrors(audioCaptureError, videoError);
    }
  }

  await applyScreenCaptureProfile(stream, profile);
  return stream;
}

async function openDesktopScreenShareWithPicker(profile: ScreenProfile): Promise<ScreenShareCapture> {
  const selection = await openDesktopCapturePicker(profile);
  const selectedProfile = getDesktopPickerProfile(selection, profile);
  const stream = await openStagedDesktopScreenShare(selectedProfile, selection.streamAudioEnabled === true);

  await applyScreenCaptureProfile(stream, selectedProfile);
  return {
    profile: selectedProfile,
    stream
  };
}

async function openDesktopCapturePicker(profile: ScreenProfile): Promise<DesktopPickerSelection> {
  const selection = await window.voiceRoomDesktopCapture!.openPicker!({
    fpsId: state.localScreenFpsId || profile.fpsId,
    qualityId: state.localScreenQualityId || profile.qualityId,
    streamAudioEnabled: true
  });

  if (!selection) throw createAbortError('Выбор источника отменен');
  return selection;
}

function getDesktopPickerProfile(selection: DesktopPickerSelection, fallbackProfile: ScreenProfile): ScreenProfile {
  if (selection?.profileId) return getScreenProfile(selection.profileId);
  if (selection?.qualityId || selection?.fpsId) {
    return getScreenProfile(createScreenProfileId(
      selection.qualityId || fallbackProfile.qualityId,
      selection.fpsId || fallbackProfile.fpsId
    ));
  }
  return fallbackProfile;
}

async function openStagedDesktopScreenShare(profile: ScreenProfile, withAudio: boolean): Promise<MediaStream> {
  const stream = await openStagedDesktopDisplayMedia();

  if (!withAudio) return stream;

  if (!hasNativeDesktopSafeAudio()) {
    showToast('Стрим запущен без звука: в этой сборке нет безопасного системного звука', {
      duration: 9000,
      variant: 'error'
    });
    return stream;
  }

  try {
    const audioCapture = await startDesktopSafeScreenAudioCapture();
    stream.addTrack(audioCapture.track);
    state.localScreenAudioCapture = audioCapture;
  } catch (error) {
    console.warn('Native desktop audio capture failed, continuing without stream audio', error);
    showToast('Стрим запущен без звука: безопасный системный звук недоступен', {
      duration: 9000,
      variant: 'error'
    });
  }

  return stream;
}

async function openStagedDesktopDisplayMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Desktop-оболочка не поддерживает staged display media capture.');
  }

  return navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: true
  });
}

function hasNativeDesktopSafeAudio(): boolean {
  const bridge = window.voiceRoomDesktopAudio;
  return Boolean(
    typeof bridge?.startSafeSystem === 'function'
      && typeof bridge?.stop === 'function'
      && typeof bridge?.onData === 'function'
      && typeof bridge?.onEvent === 'function'
  );
}

async function startDesktopSafeScreenAudioCapture(): Promise<DesktopAudioCapture> {
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
    const format = formatEvent || await formatPromise;
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

function getDesktopPcmSamples(chunk: Uint8Array | ArrayBuffer | null | undefined): Float32Array<ArrayBuffer> {
  if (!chunk) return new Float32Array();

  const bytes = chunk instanceof Uint8Array
    ? chunk
    : new Uint8Array(chunk);
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
    console.warn('Native desktop audio stop failed', error);
  });
}

async function stopDesktopAudioSession(sessionId: string): Promise<void> {
  if (!sessionId || !window.voiceRoomDesktopAudio?.stop) return;
  await window.voiceRoomDesktopAudio.stop(sessionId);
}

async function openDesktopStream(
  sourceId: string,
  profile: ScreenProfile,
  options: { audio?: boolean; audioMode?: string } = {}
): Promise<MediaStream> {
  const withAudio = options.audio !== false;
  const attempts = createDesktopCaptureAttempts(sourceId, withAudio, profile, options.audioMode || (withAudio ? 'loopback' : 'none'));
  const errors: CaptureAttemptDetail[] = [];

  for (const attempt of attempts) {
    try {
      return await attempt.open();
    } catch (error) {
      errors.push({ error, method: attempt.method });
      console.warn(`Desktop capture failed via ${attempt.method}`, error);
    }
  }

  if (errors.length) throw createDesktopCaptureError(errors);
  throw new Error('Desktop-оболочка не поддерживает захват экрана в этой сборке.');
}

function mergeDesktopCaptureErrors(...errors: unknown[]): CaptureError {
  const attemptDetails = errors.flatMap(
    (error) => (error as CaptureError)?.captureAttemptDetails || [{ error, method: 'unknown' }]
  );
  return createDesktopCaptureError(attemptDetails);
}

function createDesktopCaptureError(attemptDetails: CaptureAttemptDetail[]): CaptureError {
  const lastError = attemptDetails.at(-1)?.error as Error | undefined;
  const error: CaptureError = new Error(formatDesktopCaptureError(attemptDetails));
  error.name = lastError?.name || 'DesktopCaptureError';
  error.captureAttemptDetails = attemptDetails;
  return error;
}

function formatDesktopCaptureError(attemptDetails: CaptureAttemptDetail[]): string {
  const platform = window.voiceRoomRuntime?.platform || 'unknown';
  const displayMedia = typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? 'yes' : 'no';
  const userMedia = typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'yes' : 'no';
  const attempts = attemptDetails.map(formatCaptureAttemptError).join('\n');

  return [
    'Не удалось запустить демонстрацию экрана.',
    `Среда: desktop ${platform}, getDisplayMedia=${displayMedia}, getUserMedia=${userMedia}.`,
    'Попытки:',
    attempts
  ].join('\n');
}

function formatCaptureAttemptError({ error, method }: CaptureAttemptDetail): string {
  return `- ${method}: ${formatCaptureError(error)}`;
}

function formatCaptureError(error: unknown): string {
  if (!error) return 'unknown error';

  const errorObject = error as Error & { constraint?: string; code?: number };
  const name = errorObject.name || errorObject.constructor?.name || 'Error';
  const message = errorObject.message || String(error);
  const details: string[] = [];
  if (errorObject.constraint) details.push(`constraint=${errorObject.constraint}`);
  if (errorObject.code) details.push(`code=${errorObject.code}`);

  return [name, message, ...details].join(': ');
}

function createDesktopCaptureAttempts(
  sourceId: string,
  withAudio: boolean,
  profile: ScreenProfile,
  audioMode: string = withAudio ? 'loopback' : 'none'
): Array<{ method: string; open: () => Promise<MediaStream> }> {
  const attempts: Array<{ method: string; open: () => Promise<MediaStream> }> = [];

  if (typeof navigator.mediaDevices?.getDisplayMedia === 'function' && window.voiceRoomDesktopCapture?.selectSource) {
    attempts.push({
      method: withAudio ? `getDisplayMedia-${audioMode}` : 'getDisplayMedia-video',
      open: () => openDesktopDisplayMediaStream(sourceId, withAudio, audioMode)
    });
  }

  if (navigator.mediaDevices?.getUserMedia) {
    attempts.push({
      method: withAudio ? 'getUserMedia-desktop-audio' : 'getUserMedia-desktop-video',
      open: () => navigator.mediaDevices.getUserMedia(createDesktopMediaConstraints(sourceId, withAudio, profile))
    });
  }

  return attempts;
}

async function openDesktopDisplayMediaStream(
  sourceId: string,
  withAudio: boolean,
  audioMode: string = withAudio ? 'loopback' : 'none'
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Desktop-оболочка не поддерживает display media capture.');
  }

  if (!window.voiceRoomDesktopCapture?.selectSource) {
    throw new Error('Desktop-оболочка не дала доступ к выбору источника экрана.');
  }

  await window.voiceRoomDesktopCapture.selectSource(sourceId, {
    allowEchoFallback: false,
    enabled: withAudio,
    mode: audioMode
  });
  return navigator.mediaDevices.getDisplayMedia({
    audio: withAudio,
    video: true
  });
}

function createDesktopMediaConstraints(
  sourceId: string,
  withAudio: boolean,
  profile: ScreenProfile = getScreenProfile(DEFAULT_SCREEN_PROFILE_ID)
): MediaStreamConstraints {
  return {
    audio: withAudio
      ? {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: profile.frameRate,
        maxHeight: profile.height,
        maxWidth: profile.width
      }
    }
  } as unknown as MediaStreamConstraints;
}

async function selectDesktopCaptureSource(): Promise<DesktopCaptureSource> {
  const sources = await window.voiceRoomDesktopCapture!.getSources!();
  if (!sources.length) {
    throw new Error('Нет доступных источников экрана');
  }

  return showScreenSourcePicker(sources);
}

function showScreenSourcePicker(sources: DesktopCaptureSource[]): Promise<DesktopCaptureSource> {
  if (state.screenSourceRequest) cancelScreenSourcePicker();

  return new Promise((resolve, reject) => {
    state.screenSourceRequest = { reject, resolve };
    elements.screenSourceOptions.textContent = '';

    for (const source of sources) {
      const button = createScreenSourceButton(source);
      elements.screenSourceOptions.append(button);
    }

    elements.screenSourceDialog.hidden = false;
    window.setTimeout(() => {
      elements.screenSourceOptions.querySelector('button')?.focus();
    }, 0);
  });
}

function createScreenSourceButton(source: DesktopCaptureSource): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'screen-source-option';
  button.type = 'button';
  button.setAttribute('aria-label', source.name);

  const preview = document.createElement('span');
  preview.className = 'screen-source-preview';
  if (source.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = source.thumbnail;
    preview.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'screen-source-fallback';
    fallback.textContent = source.type === 'screen' ? 'Экран' : 'Окно';
    preview.append(fallback);
  }

  const label = document.createElement('span');
  label.className = 'screen-source-label';
  if (source.appIcon) {
    const icon = document.createElement('img');
    icon.alt = '';
    icon.src = source.appIcon;
    label.append(icon);
  }
  const name = document.createElement('span');
  name.textContent = source.name;
  label.append(name);

  button.append(preview, label);
  button.addEventListener('click', () => resolveScreenSourcePicker(source));
  return button;
}

function resolveScreenSourcePicker(source: DesktopCaptureSource): void {
  const request = closeScreenSourcePicker();
  request?.resolve(source);
}

export function cancelScreenSourcePicker(): void {
  const request = closeScreenSourcePicker();
  request?.reject(createAbortError('Выбор источника отменен'));
}

function closeScreenSourcePicker() {
  const request = state.screenSourceRequest;
  state.screenSourceRequest = null;
  elements.screenSourceDialog.hidden = true;
  elements.screenSourceOptions.textContent = '';
  return request;
}

export function closeScreenSourceOnBackdrop(event: MouseEvent): void {
  if (event.target === elements.screenSourceDialog) cancelScreenSourcePicker();
}

export function closeScreenSourceOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !state.screenSourceRequest) return;
  event.preventDefault();
  cancelScreenSourcePicker();
}

export async function applyScreenCaptureProfile(stream: MediaStream, profile: ScreenProfile): Promise<void> {
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) return;

  if ('contentHint' in videoTrack) {
    videoTrack.contentHint = profile.contentHint;
  }

  try {
    await videoTrack.applyConstraints({
      frameRate: { max: profile.frameRate },
      height: { max: profile.height },
      width: { max: profile.width }
    });
  } catch (error) {
    console.warn('Screen capture constraints unavailable', error);
  }
}
