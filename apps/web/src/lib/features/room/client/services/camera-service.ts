// The local camera: open the capture, show it in our own tile and publish it.
// The camera is off on every join; it lives only as long as the call.

import { CAMERA_CAPTURE, CAMERA_DEVICE_STORAGE_KEY } from '../core/config';
import { state } from '../core/state.svelte';
import type { CameraFacing } from '../core/types';
import { stopStream } from '../core/utils';
import { isRecord } from '@voice-room/shared/guards';
import { showToast } from '../ui/toast';
import { publishLocalCamera, unpublishLocalCamera } from './livekit/local-publications';
import { askForMedia, describeMediaRefusal } from './media-grant';
import { postState } from '../room/presence';
import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:camera');

export async function toggleCamera(): Promise<void> {
  if (state.cameraStarting) return;
  if (state.localCameraStream) {
    await stopCamera();
    return;
  }
  await startCamera();
}

async function startCamera(): Promise<void> {
  if (!state.joined) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Камера недоступна в этом браузере');
    return;
  }

  state.cameraStarting = true;
  try {
    const grant = await askForMedia('camera');
    if (grant && !grant.granted) {
      showToast(describeMediaRefusal(grant), { duration: 12000, variant: 'error' });
      return;
    }
    const stream = await openCameraCapture(state.cameraDeviceId);
    if (!state.joined) {
      stopStream(stream);
      return;
    }
    adoptCameraStream(stream);
    await publishLocalCamera();
    // The server counts the camera against its media budget from here on.
    await postState();
  } catch (error) {
    log.warn('camera start failed', errorContext(error));
    await stopCamera();
    showToast(describeCameraError(error));
  } finally {
    state.cameraStarting = false;
  }
}

export async function stopCamera(): Promise<void> {
  const stream = state.localCameraStream;
  releaseLocalCamera();
  await unpublishLocalCamera().catch((error: unknown) => log.warn('camera unpublish failed', errorContext(error)));
  if (stream) stopStream(stream);
  if (stream) await postState();
}

/** Leaving the room: the LiveKit room goes away with the publication. */
export function stopLocalCamera(): void {
  const stream = state.localCameraStream;
  releaseLocalCamera();
  state.localCameraPublication = null;
  state.cameraStarting = false;
  if (stream) stopStream(stream);
}

export async function switchCamera(deviceId: string): Promise<void> {
  persistCameraDeviceId(deviceId);
  if (!state.localCameraStream || state.cameraStarting) return;

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
  if (!previous || state.cameraStarting) return;
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
      showToast(isMissingDeviceError(error) ? 'Другой камеры нет' : describeCameraError(error));
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
    showToast('Камера отключилась');
  });
  if (state.self) {
    state.self.camera = true;
    state.self.cameraStream = stream;
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
    if (state.cameraDeviceId) localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, state.cameraDeviceId);
    else localStorage.removeItem(CAMERA_DEVICE_STORAGE_KEY);
  } catch {
    // Storage may be blocked; the choice then lasts for this page only.
  }
}

function isMissingDeviceError(error: unknown): boolean {
  const name = isRecord(error) ? error.name : undefined;
  return name === 'NotFoundError' || name === 'OverconstrainedError';
}

export function describeCameraError(error: unknown): string {
  const name = isRecord(error) ? error.name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к камере: разрешите её в браузере';
  if (isMissingDeviceError(error)) return 'Камера не найдена';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Камера занята другим приложением';
  return 'Не удалось включить камеру';
}
