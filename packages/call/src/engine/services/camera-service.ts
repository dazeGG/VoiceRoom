import { getInstalledCallPorts } from '../ports';
import { writeStorage, removeStorage } from '../core/storage';
// The local camera: open the capture, show it in our own tile and publish it.
// The camera is off on every join; it lives only as long as the call.

import { t } from '@voiceroom/ui-kit/i18n';
import { markRaw } from 'vue';
import { CAMERA_CAPTURE, CAMERA_DEVICE_STORAGE_KEY } from '../core/config';
import { state } from '../core/room-runtime.store';
import type { CameraFacing } from '../core/types';
import { stopStream } from '../core/utils';
import { isRecord } from '@voiceroom/shared/guards';
import { showToast } from '../ui/toast';
import {
  publishLocalCamera,
  publishLocalCameraForRoom,
  unpublishCameraTrack,
  unpublishLocalCamera
} from './livekit/local-publications';
import { askForMedia, describeMediaRefusal } from './media-grant';
import { postState } from '../room/presence';
import { createLogger, errorContext } from '../diagnostics';

const log = createLogger('room:camera');
let pendingCameraStream: MediaStream | null = null;

export async function toggleCamera(): Promise<void> {
  if (state.cameraStarting) return;
  if (state.localCameraStream) {
    await stopCamera();
    return;
  }
  await startCamera();
}

async function startCamera(): Promise<void> {
  if (
    state.cameraStarting ||
    state.localCameraStream ||
    getInstalledCallPorts()?.mediaPolicy.camera === false ||
    !state.joined
  )
    return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast(t('Камера недоступна в этом браузере'));
    return;
  }

  state.cameraStarting = true;
  const self = state.self;
  const isCurrent = () => state.joined && state.self === self;
  const canUseCamera = () => isCurrent() && getInstalledCallPorts()?.mediaPolicy.camera !== false;
  let stream: MediaStream | undefined;
  try {
    const grant = await askForMedia('camera');
    if (!canUseCamera()) return;
    if (grant && !grant.granted) {
      showToast(describeMediaRefusal(grant), { duration: 12000, variant: 'error' });
      return;
    }
    stream = await openCameraCapture(state.cameraDeviceId);
    if (!canUseCamera()) {
      stopStream(stream);
      return;
    }
    pendingCameraStream = stream;
    const room = state.livekitRoom;
    const isCurrentPublication = () => canUseCamera() && state.livekitRoom === room && pendingCameraStream === stream;
    const publication = room && (await publishLocalCameraForRoom(room, stream, isCurrentPublication));
    const [track] = stream.getVideoTracks();
    if (
      !publication ||
      !isCurrentPublication() ||
      track?.readyState !== 'live' ||
      publication.track?.mediaStreamTrack !== track
    ) {
      if (room && publication && track) {
        void unpublishCameraTrack(room, track).catch((error: unknown) =>
          log.warn('camera unpublish failed', errorContext(error))
        );
      }
      throw new Error('No live camera publication');
    }
    state.localCameraPublication = publication;
    adoptCameraStream(stream);
    pendingCameraStream = null;
    // The server counts the camera against its media budget from here on.
    await postState();
  } catch (error) {
    if (!isCurrent()) return;
    log.warn('camera start failed', errorContext(error));
    if (stream) {
      if (state.localCameraStream === stream) await stopCamera();
      if (isCurrent()) showToast(t('Не удалось включить камеру'));
    } else if (isCameraPromptDismissed(error)) {
      showToast(t('Запрос доступа к камере закрыт'), {
        actionLabel: t('Повторить'),
        action: () => {
          if (isCurrent()) return startCamera();
        }
      });
    } else {
      showToast(describeCameraError(error));
    }
  } finally {
    if (stream && pendingCameraStream === stream) {
      pendingCameraStream = null;
      stopStream(stream);
    }
    if (isCurrent()) state.cameraStarting = false;
  }
}

export async function stopCamera(): Promise<void> {
  const stream = state.localCameraStream;
  releaseLocalCamera();
  if (stream) stopStream(stream);
  const unpublishing = unpublishLocalCamera().catch((error: unknown) =>
    log.warn('camera unpublish failed', errorContext(error))
  );
  if (stream) await postState();
  await unpublishing;
}

/** Leaving the room: the LiveKit room goes away with the publication. */
export function stopLocalCamera(): void {
  const stream = state.localCameraStream;
  const pending = pendingCameraStream;
  pendingCameraStream = null;
  releaseLocalCamera();
  state.localCameraPublication = null;
  state.cameraStarting = false;
  if (stream) stopStream(stream);
  if (pending) stopStream(pending);
}

export async function switchCamera(deviceId: string): Promise<void> {
  persistCameraDeviceId(deviceId);
  if (getInstalledCallPorts()?.mediaPolicy.camera === false || !state.localCameraStream || state.cameraStarting) return;

  state.cameraStarting = true;
  try {
    const next = await openCameraCapture(state.cameraDeviceId);
    const previous = state.localCameraStream;
    await unpublishLocalCamera().catch((error: unknown) => log.warn('camera unpublish failed', errorContext(error)));
    if (previous) stopStream(previous);
    adoptCameraStream(next);
    await publishLocalCamera();
  } catch (error) {
    log.warn('camera switch failed', errorContext(error));
    showToast(describeCameraError(error));
  } finally {
    state.cameraStarting = false;
  }
}

/**
 * A phone turns between its front and back camera. Most phones open one
 * camera at a time, so the current capture is released before the other one
 * opens; if the other one fails, the camera comes back the way it looked.
 */
export async function flipCamera(): Promise<void> {
  const previous = state.localCameraStream;
  if (getInstalledCallPorts()?.mediaPolicy.camera === false || !previous || state.cameraStarting) return;
  const to: CameraFacing = state.cameraFacing === 'user' ? 'environment' : 'user';
  // Reopened by its device if the other side fails: not every camera reports a facing.
  const previousDeviceId = previous.getVideoTracks()[0]?.getSettings?.().deviceId ?? '';

  state.cameraStarting = true;
  try {
    await unpublishLocalCamera().catch((error: unknown) => log.warn('camera unpublish failed', errorContext(error)));
    stopStream(previous);
    let next: MediaStream;
    let facing: CameraFacing | undefined;
    try {
      next = await openFacingCapture(to);
      facing = to;
      // The facing now picks the camera; a remembered device would override it.
      persistCameraDeviceId('');
    } catch (error) {
      log.warn('camera flip failed', errorContext(error));
      showToast(isMissingDeviceError(error) ? t('Другой камеры нет') : describeCameraError(error));
      next = await openCameraCapture(previousDeviceId);
    }
    // Leaving the room while the capture opened drops it.
    if (state.localCameraStream !== previous) {
      stopStream(next);
      return;
    }
    adoptCameraStream(next, facing);
    await publishLocalCamera();
  } catch (error) {
    log.warn('camera reopen failed', errorContext(error));
    await stopCamera();
    showToast(describeCameraError(error));
  } finally {
    state.cameraStarting = false;
  }
}

/**
 * `opened` is the side that was asked for; what the camera says about itself
 * wins, so a back camera chosen by its device is not shown mirrored.
 */
function adoptCameraStream(stream: MediaStream, opened?: CameraFacing): void {
  const reported = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  if (reported === 'user' || reported === 'environment') state.cameraFacing = reported;
  else state.cameraFacing = opened ?? 'user';
  state.localCameraStream = stream;
  // Unplugging the camera or revoking access ends the track.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (state.localCameraStream !== stream) return;
    void stopCamera();
    showToast(t('Камера отключилась'));
  });
  if (state.self) {
    state.self.camera = true;
    state.self.cameraStream = markRaw(stream);
  }
}

function releaseLocalCamera(): void {
  state.localCameraStream = null;
  if (state.self) {
    state.self.camera = false;
    state.self.cameraStream = null;
  }
}

const CAMERA_VIDEO_CONSTRAINTS = {
  width: { ideal: CAMERA_CAPTURE.width },
  height: { ideal: CAMERA_CAPTURE.height },
  frameRate: { ideal: CAMERA_CAPTURE.frameRate, max: CAMERA_CAPTURE.frameRate }
};

function openFacingCapture(facing: CameraFacing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { ...CAMERA_VIDEO_CONSTRAINTS, facingMode: { exact: facing } }
  });
}

async function openCameraCapture(deviceId: string): Promise<MediaStream> {
  const video = CAMERA_VIDEO_CONSTRAINTS;
  // Without a chosen device a phone turned to its back camera opens it again.
  // Nothing else asks for a facing: on a computer it would prefer the built-in
  // camera over the default one.
  if (!deviceId)
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: state.cameraFacing === 'environment' ? { ...video, facingMode: { ideal: 'environment' } } : video
    });

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...video, deviceId: { exact: deviceId } }
    });
  } catch (error) {
    // The remembered camera is gone: take the system one and forget it.
    if (!isMissingDeviceError(error)) throw error;
    persistCameraDeviceId('');
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
}

function persistCameraDeviceId(deviceId: string): void {
  state.cameraDeviceId = deviceId || '';
  try {
    if (state.cameraDeviceId) writeStorage(CAMERA_DEVICE_STORAGE_KEY, state.cameraDeviceId);
    else removeStorage(CAMERA_DEVICE_STORAGE_KEY);
  } catch {
    // Storage may be blocked; the choice then lasts for this page only.
  }
}

function isMissingDeviceError(error: unknown): boolean {
  const name = isRecord(error) ? error.name : undefined;
  return name === 'NotFoundError' || name === 'OverconstrainedError';
}

function isCameraPromptDismissed(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.name === 'NotAllowedError' &&
    typeof error.message === 'string' &&
    error.message.trim().toLowerCase() === 'permission dismissed'
  );
}

export function describeCameraError(error: unknown): string {
  const name = isRecord(error) ? error.name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('Нет доступа к камере: разрешите её в браузере');
  if (isMissingDeviceError(error)) return t('Камера не найдена');
  if (name === 'NotReadableError' || name === 'AbortError') return t('Камера занята другим приложением');
  return t('Не удалось включить камеру');
}
