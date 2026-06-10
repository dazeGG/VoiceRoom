export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function waitForUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(() => resolve(), 0));
}

export function hasLeadingZeroBits(bytes: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== 0) return false;
  }

  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return (bytes[fullBytes] & mask) === 0;
}

export function cleanDisplayName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function getInitials(name: string): string {
  const words = String(name || 'Гость').trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function hashStringToHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }

  return ((hash % 360) + 360) % 360;
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

export function errorName(error: unknown): string {
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
