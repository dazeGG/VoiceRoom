// How long LiveKit keeps trying to resume a dropped signal connection.
//
// Audio and video go straight to the LiveKit server; only the signal channel
// runs through the API's auth-gate. While the API and the gate restart for a
// deploy, the call keeps playing, and LiveKit's default policy would still end
// it after ten attempts (about 48 s). So the first attempts stay as quick as
// the default and later ones repeat every few seconds for up to five minutes.

import type { ReconnectContext, ReconnectPolicy } from 'livekit-client';

export const SIGNAL_RESUME_WINDOW_MS = 5 * 60_000;
const EARLY_DELAYS_MS = [0, 300, 1_200, 2_700];
const STEADY_DELAY_MS = 3_000;
const JITTER_MS = 1_000;

export function createSignalReconnectPolicy(random: () => number = Math.random): ReconnectPolicy {
  return {
    nextRetryDelayInMs(context: ReconnectContext): number | null {
      if (context.elapsedMs >= SIGNAL_RESUME_WINDOW_MS) return null;
      const early = EARLY_DELAYS_MS[context.retryCount];
      if (early !== undefined) return early;
      // Spread the retries of everyone in a call so a restarted gate is not hit at once.
      return STEADY_DELAY_MS + Math.round(random() * JITTER_MS);
    }
  };
}
