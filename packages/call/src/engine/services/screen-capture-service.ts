import { getInstalledCallPorts } from '../ports';
import { t } from '@voice-room/ui/i18n';
import { DEFAULT_SCREEN_PROFILE_ID, SCREEN_QUALITY_OPTIONS } from '../core/config';
import { state } from '../core/room-runtime.store';
import { showToast } from '../ui/toast';
import { createScreenProfileId, getScreenProfile } from '../media/profiles';
import { createAbortError, isCaptureCancelled } from '../core/utils';
import { isRecord } from '@voice-room/shared/guards';
import { showScreenSourcePicker } from '../ui/screen-source-picker';
import { setLocalAppAudioSuppressed } from './media-playback-service';
import { hasNativeDesktopSafeAudio, startDesktopSafeScreenAudioCapture } from './desktop-screen-audio';
import type { DesktopPickerSelection, ScreenProfile, ScreenSourceSelection, ScreenStreamMode } from '../core/types';

import { createLogger, errorContext } from '../diagnostics';

const log = createLogger('room:screen-capture');

interface CaptureAttemptDetail {
  error: unknown;
  method: string;
}

/** Every way a desktop capture was tried, and how each one failed. */
class DesktopCaptureError extends Error {
  readonly captureAttemptDetails: CaptureAttemptDetail[];

  constructor(message: string, name: string, captureAttemptDetails: CaptureAttemptDetail[]) {
    super(message);
    this.name = name;
    this.captureAttemptDetails = captureAttemptDetails;
  }
}

/** Chrome's display-capture hints, not in lib.dom yet. */
interface ChromeDisplayMediaOptions extends DisplayMediaStreamOptions {
  audio?: boolean | (MediaTrackConstraints & { suppressLocalAudioPlayback?: boolean });
  selfBrowserSurface?: 'exclude' | 'include';
  surfaceSwitching?: 'exclude' | 'include';
  systemAudio?: 'exclude' | 'include';
  windowAudio?: 'exclude' | 'system' | 'window';
}

/** Electron's desktop source, picked with Chrome's legacy `mandatory` constraints. */
type DesktopTrackConstraints = MediaTrackConstraints & { mandatory: Record<string, string | number> };

export interface ScreenShareCapture {
  mode?: ScreenStreamMode;
  profile: ScreenProfile;
  stream: MediaStream;
}

function wantsScreenShareAudio(): boolean {
  return true;
}

export async function openScreenShare(profile: ScreenProfile): Promise<ScreenShareCapture> {
  if (hasDesktopOpenPicker()) {
    return openDesktopScreenShareWithPicker(profile);
  }

  if (hasLegacyDesktopCapture()) {
    return openDesktopScreenShare(profile);
  }

  if (isDesktopApp()) {
    throw new Error(t('Desktop-оболочка не загрузила модуль выбора экрана. Перезапустите приложение из новой сборки.'));
  }

  return {
    profile,
    stream: await openBrowserScreenShare(profile)
  };
}

function hasDesktopOpenPicker(): boolean {
  return typeof getInstalledCallPorts()?.platform.desktop.capture?.openPicker === 'function';
}

function hasLegacyDesktopCapture(): boolean {
  return Boolean(getInstalledCallPorts()?.platform.desktop.capture?.getSources);
}

function isDesktopApp(): boolean {
  return Boolean(getInstalledCallPorts()?.platform.desktop.runtime?.isDesktop);
}

async function openBrowserScreenShare(profile: ScreenProfile): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(t('Браузер не поддерживает демонстрацию экрана. Нужен HTTPS или localhost.'));
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      createBrowserDisplayMediaConstraints(profile, {
        audio: wantsScreenShareAudio(),
        suppressLocalAudioPlayback: false
      })
    );
  } catch (error) {
    if (!isRecord(error) || error.name !== 'TypeError') throw error;
    stream = await navigator.mediaDevices.getDisplayMedia(
      createBrowserDisplayMediaConstraints(profile, {
        audio: wantsScreenShareAudio(),
        includeAudioHints: false,
        suppressLocalAudioPlayback: false
      })
    );
  }

  await applyScreenCaptureProfile(stream, profile);
  return stream;
}

function createBrowserDisplayMediaConstraints(
  profile: ScreenProfile,
  options: { audio?: boolean; includeAudioHints?: boolean; suppressLocalAudioPlayback?: boolean } = {}
): ChromeDisplayMediaOptions {
  const { audio = true, includeAudioHints = true, suppressLocalAudioPlayback = false } = options;
  const video = createScreenVideoConstraints(profile);

  const withVideo = video === undefined ? {} : { video };
  if (!audio) {
    return {
      audio: false,
      ...withVideo
    };
  }

  return {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback
    },
    ...withVideo,
    ...(includeAudioHints
      ? {
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: 'include',
          windowAudio: 'system'
        }
      : {})
  };
}

function createScreenVideoConstraints(profile: ScreenProfile): DisplayMediaStreamOptions['video'] {
  if (SCREEN_QUALITY_OPTIONS[profile.qualityId]?.source) {
    return {
      frameRate: { ideal: profile.frameRate, max: profile.frameRate }
    };
  }

  return {
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
    height: { ideal: profile.height, max: profile.height },
    width: { ideal: profile.width, max: profile.width }
  };
}

async function openDesktopScreenShare(profile: ScreenProfile): Promise<ScreenShareCapture> {
  if (!navigator.mediaDevices?.getDisplayMedia && !navigator.mediaDevices?.getUserMedia) {
    throw new Error(t('Desktop-оболочка не дала доступ к захвату экрана.'));
  }

  const selection = await selectDesktopCaptureSource();
  const source = selection.source;
  const selectedProfile = getDesktopPickerProfile(selection, profile);
  const withAudio = selection.streamAudioEnabled === true;
  let stream: MediaStream;

  if (!withAudio) {
    stream = await openDesktopStream(source.id, selectedProfile, { audio: false, audioMode: 'none' });
    await applyScreenCaptureProfile(stream, selectedProfile);
    return { mode: selection.mode, profile: selectedProfile, stream };
  }

  if (hasNativeDesktopSafeAudio()) {
    stream = await openDesktopStream(source.id, selectedProfile, { audio: false, audioMode: 'safe-system' });
    try {
      const audioCapture = await startDesktopSafeScreenAudioCapture();
      stream.addTrack(audioCapture.track);
      state.localScreenAudioCapture = audioCapture;
    } catch (error) {
      log.warn('native desktop audio capture failed, continuing without stream audio', errorContext(error));
      showToast(t('Стрим запущен без звука: безопасный системный звук недоступен'), {
        duration: 9000,
        variant: 'error'
      });
    }

    await applyScreenCaptureProfile(stream, selectedProfile);
    return { mode: selection.mode, profile: selectedProfile, stream };
  }

  if (isDesktopApp()) {
    stream = await openDesktopStream(source.id, selectedProfile, { audio: false, audioMode: 'safe-system' });
    showToast(t('Стрим запущен без звука: в этой сборке нет безопасного системного звука'), {
      duration: 9000,
      variant: 'error'
    });
    await applyScreenCaptureProfile(stream, selectedProfile);
    return { mode: selection.mode, profile: selectedProfile, stream };
  }

  try {
    stream = await openDesktopStream(source.id, selectedProfile, { audio: true, audioMode: 'loopback' });
  } catch (error) {
    if (isCaptureCancelled(error)) {
      setLocalAppAudioSuppressed(false);
      throw error;
    }
    log.warn('desktop audio capture unavailable, retrying without audio', errorContext(error));
    try {
      stream = await openDesktopStream(source.id, selectedProfile, { audio: false, audioMode: 'none' });
    } catch (videoError) {
      throw mergeDesktopCaptureErrors(error, videoError);
    }
  }

  await applyScreenCaptureProfile(stream, selectedProfile);
  return { mode: selection.mode, profile: selectedProfile, stream };
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
  const bridge = getInstalledCallPorts()?.platform.desktop.capture;
  if (!bridge?.openPicker) throw new Error(t('Desktop-оболочка не поддерживает выбор источника экрана.'));
  const selection = await bridge.openPicker({
    fpsId: state.localScreenFpsId || profile.fpsId,
    qualityId: state.localScreenQualityId || profile.qualityId,
    streamAudioEnabled: true
  });

  if (!selection) throw createAbortError(t('Выбор источника отменен'));
  return selection;
}

function getDesktopPickerProfile(selection: DesktopPickerSelection, fallbackProfile: ScreenProfile): ScreenProfile {
  if (selection?.profileId) return getScreenProfile(selection.profileId);
  if (selection?.qualityId || selection?.fpsId) {
    return getScreenProfile(
      createScreenProfileId(selection.qualityId || fallbackProfile.qualityId, selection.fpsId || fallbackProfile.fpsId)
    );
  }
  return fallbackProfile;
}

async function openStagedDesktopScreenShare(profile: ScreenProfile, withAudio: boolean): Promise<MediaStream> {
  const stream = await openStagedDesktopDisplayMedia(profile);

  if (!withAudio) return stream;

  if (!hasNativeDesktopSafeAudio()) {
    showToast(t('Стрим запущен без звука: в этой сборке нет безопасного системного звука'), {
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
    log.warn('native desktop audio capture failed, continuing without stream audio', errorContext(error));
    showToast(t('Стрим запущен без звука: безопасный системный звук недоступен'), {
      duration: 9000,
      variant: 'error'
    });
  }

  return stream;
}

async function openStagedDesktopDisplayMedia(profile: ScreenProfile): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(t('Desktop-оболочка не поддерживает staged display media capture.'));
  }

  const video: MediaTrackConstraints = {
    frameRate: { ideal: profile.frameRate, max: profile.frameRate }
  };
  if (!SCREEN_QUALITY_OPTIONS[profile.qualityId]?.source) {
    video.height = { ideal: profile.height, max: profile.height };
    video.width = { ideal: profile.width, max: profile.width };
  }

  return navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video
  });
}

async function openDesktopStream(
  sourceId: string,
  profile: ScreenProfile,
  options: { audio?: boolean; audioMode?: string } = {}
): Promise<MediaStream> {
  const withAudio = options.audio !== false;
  const attempts = createDesktopCaptureAttempts(
    sourceId,
    withAudio,
    profile,
    options.audioMode || (withAudio ? 'loopback' : 'none')
  );
  const errors: CaptureAttemptDetail[] = [];

  for (const attempt of attempts) {
    try {
      return await attempt.open();
    } catch (error) {
      errors.push({ error, method: attempt.method });
      log.warn(`Desktop capture failed via ${attempt.method}`, errorContext(error));
    }
  }

  if (errors.length) throw createDesktopCaptureError(errors);
  throw new Error(t('Desktop-оболочка не поддерживает захват экрана в этой сборке.'));
}

function mergeDesktopCaptureErrors(...errors: unknown[]): DesktopCaptureError {
  const attemptDetails = errors.flatMap((error) =>
    error instanceof DesktopCaptureError ? error.captureAttemptDetails : [{ error, method: 'unknown' }]
  );
  return createDesktopCaptureError(attemptDetails);
}

function createDesktopCaptureError(attemptDetails: CaptureAttemptDetail[]): DesktopCaptureError {
  const lastError = attemptDetails.at(-1)?.error;
  const lastName = isRecord(lastError) && typeof lastError.name === 'string' ? lastError.name : '';
  return new DesktopCaptureError(
    formatDesktopCaptureError(attemptDetails),
    lastName || 'DesktopCaptureError',
    attemptDetails
  );
}

function formatDesktopCaptureError(attemptDetails: CaptureAttemptDetail[]): string {
  const platform = getInstalledCallPorts()?.platform.desktop.runtime?.platform || 'unknown';
  const displayMedia = typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? 'yes' : 'no';
  const userMedia = typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'yes' : 'no';
  const attempts = attemptDetails.map(formatCaptureAttemptError).join('\n');

  return [
    t('Не удалось запустить демонстрацию экрана.'),
    t('Среда: desktop {p0}, getDisplayMedia={p1}, getUserMedia={p2}.', {
      p0: platform,
      p1: displayMedia,
      p2: userMedia
    }),
    t('Попытки:'),
    attempts
  ].join('\n');
}

function formatCaptureAttemptError({ error, method }: CaptureAttemptDetail): string {
  return `- ${method}: ${formatCaptureError(error)}`;
}

function formatCaptureError(error: unknown): string {
  if (!error) return 'unknown error';

  const fields = isRecord(error) ? error : {};
  const name = (typeof fields.name === 'string' && fields.name) || 'Error';
  const primitive = typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean';
  const message = (typeof fields.message === 'string' && fields.message) || (primitive ? String(error) : '');
  const details: string[] = [];
  if (typeof fields.constraint === 'string' && fields.constraint) details.push(`constraint=${fields.constraint}`);
  if (typeof fields.code === 'number' && fields.code) details.push(`code=${fields.code}`);

  return [name, message, ...details].filter(Boolean).join(': ');
}

function createDesktopCaptureAttempts(
  sourceId: string,
  withAudio: boolean,
  profile: ScreenProfile,
  audioMode: string = withAudio ? 'loopback' : 'none'
): Array<{ method: string; open: () => Promise<MediaStream> }> {
  const attempts: Array<{ method: string; open: () => Promise<MediaStream> }> = [];

  if (
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    getInstalledCallPorts()?.platform.desktop.capture?.selectSource
  ) {
    attempts.push({
      method: withAudio ? `getDisplayMedia-${audioMode}` : 'getDisplayMedia-video',
      open: () => openDesktopDisplayMediaStream(sourceId, withAudio, audioMode, profile)
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
  audioMode: string = withAudio ? 'loopback' : 'none',
  profile: ScreenProfile = getScreenProfile(DEFAULT_SCREEN_PROFILE_ID)
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(t('Desktop-оболочка не поддерживает display media capture.'));
  }

  const bridge = getInstalledCallPorts()?.platform.desktop.capture;
  if (!bridge?.selectSource) {
    throw new Error(t('Desktop-оболочка не дала доступ к выбору источника экрана.'));
  }

  await bridge.selectSource(
    sourceId,
    {
      allowEchoFallback: false,
      enabled: withAudio,
      mode: audioMode
    },
    {
      fpsId: profile.fpsId,
      qualityId: profile.qualityId
    }
  );
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
  const audio: DesktopTrackConstraints = { mandatory: { chromeMediaSource: 'desktop' } };
  const video: DesktopTrackConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxFrameRate: profile.frameRate,
      ...(SCREEN_QUALITY_OPTIONS[profile.qualityId]?.source
        ? {}
        : {
            maxHeight: profile.height,
            maxWidth: profile.width
          })
    }
  };
  return { audio: withAudio ? audio : false, video };
}

async function selectDesktopCaptureSource(): Promise<ScreenSourceSelection> {
  const bridge = getInstalledCallPorts()?.platform.desktop.capture;
  if (!bridge?.getSources) throw new Error(t('Desktop-оболочка не отдаёт список источников экрана.'));
  const sources = await bridge.getSources();
  if (!sources.length) {
    throw new Error(t('Нет доступных источников экрана'));
  }

  return showScreenSourcePicker(sources);
}

export async function applyScreenCaptureProfile(stream: MediaStream, profile: ScreenProfile): Promise<void> {
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) return;

  if ('contentHint' in videoTrack) {
    videoTrack.contentHint = profile.contentHint;
  }

  if (await applyDesktopCaptureProfile(profile)) return;

  try {
    const constraints: MediaTrackConstraints = {
      frameRate: { ideal: profile.frameRate, max: profile.frameRate }
    };
    if (!SCREEN_QUALITY_OPTIONS[profile.qualityId]?.source) {
      constraints.height = { ideal: profile.height, max: profile.height };
      constraints.width = { ideal: profile.width, max: profile.width };
    }
    await videoTrack.applyConstraints(constraints);
  } catch (error) {
    log.warn('screen capture constraints unavailable', errorContext(error));
  }
}

async function applyDesktopCaptureProfile(profile: { fpsId: string; qualityId: string }): Promise<boolean> {
  const bridge = getInstalledCallPorts()?.platform.desktop.capture;
  if (typeof bridge?.applyProfile !== 'function') return false;
  try {
    const result = await bridge.applyProfile({ fpsId: profile.fpsId, qualityId: profile.qualityId });
    if (!result?.ok) {
      log.info('desktop capture profile not applied', { ...profile, reason: result?.reason ?? 'unacknowledged' });
    }
    return result?.ok === true;
  } catch (error) {
    log.warn('desktop applyProfile failed, falling back to constraints', errorContext(error));
    return false;
  }
}

/** Limit capture work without changing the chosen mode, resolution, hint or audio. */
export async function limitScreenCaptureFrameRate(
  stream: MediaStream,
  profile: ScreenProfile,
  maxFrameRate: number
): Promise<void> {
  const [track] = stream.getVideoTracks();
  if (!track || profile.frameRate <= maxFrameRate) return;
  // Native IPC controls the current capture globally, not an arbitrary track.
  const isCurrent = () => state.localScreenStream === stream && track.readyState !== 'ended';
  if (!isCurrent()) return;
  const frameRate = track.getSettings().frameRate;
  if (frameRate !== undefined && Number.isFinite(frameRate) && frameRate > 0 && frameRate <= maxFrameRate) return;

  // The existing desktop bridge expands source-60's 1440p ceiling to 4K at
  // lower rates. Do not increase its capture work while trying to relieve it.
  // That native profile needs an FPS-only desktop API; browser constraints
  // remain best effort, including when an older desktop refuses the request.
  const keepsNativeSize = profile.qualityId !== 'source' || profile.frameRate <= 30;
  if (!keepsNativeSize && getInstalledCallPorts()?.platform.desktop.capture?.applyProfile) {
    log.info('native screen rate kept to preserve source size', { profileId: profile.id });
  }
  if (
    keepsNativeSize &&
    (await applyDesktopCaptureProfile({ fpsId: String(maxFrameRate), qualityId: profile.qualityId }))
  )
    return;
  if (!isCurrent()) return;
  try {
    // applyConstraints replaces the constraint set; retain the existing size
    // ceiling rather than accidentally increasing pixels as FPS comes down.
    await track.applyConstraints({ ...track.getConstraints(), frameRate: { max: maxFrameRate } });
  } catch (error) {
    log.info('screen frame rate kept', errorContext(error));
  }
}
