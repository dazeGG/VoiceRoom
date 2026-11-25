import { startCallRinger, waitForCallRingerAudio } from '@voiceroom/call/engine';

export async function ringOnThisDevice(signal: AbortSignal): Promise<void> {
  const locks = navigator.locks;
  // A tab blocked by autoplay must not hold the audible tab's lock.
  if (!locks || !(await waitForCallRingerAudio(signal)) || signal.aborted) return;
  // The notification router uses the same origin-wide locking mechanism.
  try {
    await locks.request('voice-room:incoming-call-ringer', { signal }, () => {
      if (signal.aborted) return;
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
        startCallRinger(signal);
      });
    });
  } catch {
    // A cancelled lock request or unavailable audio leaves the cards interactive.
  }
}
