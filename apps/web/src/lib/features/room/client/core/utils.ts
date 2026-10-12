import { avatarInitial } from '$lib/shared/utils/avatar-initial';

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function cleanDisplayName(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

export function getInitials(name: string): string {
  return avatarInitial(name || 'Гость');
}

export function isSafariBrowser(): boolean {
  const userAgent = navigator.userAgent || '';
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(userAgent);
}

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isCaptureCancelled(error: unknown): boolean {
  return errorName(error) === 'NotAllowedError' || errorName(error) === 'AbortError';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || '');
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export function disconnectAudioNode(node: AudioNode | null | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // The graph may already be partially disconnected after a failed worklet setup.
  }
}
