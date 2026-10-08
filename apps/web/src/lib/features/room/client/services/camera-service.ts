// The local camera: open the capture, show it in our own tile and publish it.
// The camera is off on every join; it lives only as long as the call.

import { CAMERA_CAPTURE, CAMERA_DEVICE_STORAGE_KEY } from '../core/config';
import { state } from '../core/state.svelte';
import { stopStream } from '../core/utils';
import { showToast } from '../ui/toast';
import { publishLocalCamera, unpublishLocalCamera } from './livekit/local-publications';
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
    const stream = await openCameraCapture(state.cameraDeviceId);
    if (!state.joined) {
      stopStream(stream);
      return;
    }
    adoptCameraStream(stream);
    await publishLocalCamera();
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
  await unpublishLocalCamera().catch((error) => log.warn('camera unpublish failed', errorContext(error)));
  if (stream) stopStream(stream);
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
    await unpublishLocalCamera().catch((error) => log.warn('camera unpublish failed', errorContext(error)));
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

function adoptCameraStream(stream: MediaStream): void {
  state.localCameraStream = stream;
  // Unplugging the camera or revoking access ends the track.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (state.localCameraStream === stream) void stopCamera();
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

async function openCameraCapture(deviceId: string): Promise<MediaStream> {
  const video = {
    width: { ideal: CAMERA_CAPTURE.width },
    height: { ideal: CAMERA_CAPTURE.height },
    frameRate: { ideal: CAMERA_CAPTURE.frameRate, max: CAMERA_CAPTURE.frameRate }
  };
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: false, video });

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
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotFoundError' || name === 'OverconstrainedError';
}

export function describeCameraError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к камере: разрешите её в браузере';
  if (isMissingDeviceError(error)) return 'Камера не найдена';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Камера занята другим приложением';
  return 'Не удалось включить камеру';
}
