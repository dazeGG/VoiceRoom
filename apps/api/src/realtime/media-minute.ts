// The server's video over each minute, for the admin panel's server page:
// how many screen shares and cameras ran at once at most, the most video the
// budget counted as sent to viewers against the budget itself, and how many
// stream starts the budget lowered or refused. Only counts, no people or
// rooms. The peaks move whenever a screen or camera starts or a start is
// decided, and the minute's sample (system-snapshot.service.ts) takes them and
// starts the next minute from what is running then.

import { screenProfileFallbacks } from '@voice-room/shared/media-budget';
import type { MediaGrant, MediaKind } from '@voice-room/shared/contracts/realtime';
import { serverMediaBps, videoBudgetBps, type MediaLimits } from './media-budget.ts';
import type { PresenceRoom } from './runtime-types.ts';

export type MediaMinute = {
  screensMax: number;
  camerasMax: number;
  /** What the running and granted streams send their viewers, at its highest, in Mbit/s. */
  videoMbpsMax: number;
  /** The video budget at the minute's end; null while the budget is off. */
  videoBudgetMbps: number | null;
  /** Screen shares started at a lower profile than asked, and starts refused. */
  lowered: number;
  refused: number;
};

type MediaNow = { screens: number; cameras: number; bps: number };

export function createMediaMinute({
  rooms,
  limits,
  now
}: {
  rooms: () => Iterable<PresenceRoom, unknown, unknown>;
  limits: Pick<MediaLimits, 'budgetBps' | 'voicePeersAtZero'>;
  now: () => number;
}) {
  let peak: MediaNow = { screens: 0, cameras: 0, bps: 0 };
  let lowered = 0;
  let refused = 0;

  function current(): MediaNow {
    let screens = 0;
    let cameras = 0;
    const list = Array.from(rooms());
    for (const room of list) {
      for (const peer of room.peers.values()) {
        if (peer.screen) screens += 1;
        if (peer.camera) cameras += 1;
      }
    }
    return { screens, cameras, bps: serverMediaBps(list, now()) };
  }

  /** A screen or camera changed: the peaks take what runs now. */
  function note(): void {
    const at = current();
    peak = {
      screens: Math.max(peak.screens, at.screens),
      cameras: Math.max(peak.cameras, at.cameras),
      bps: Math.max(peak.bps, at.bps)
    };
  }

  /** A start was decided: refused, or a screen share granted below the profile asked for. */
  function noteDecision(kind: MediaKind, askedProfileId: string, grant: MediaGrant): void {
    if (!grant.granted) refused += 1;
    else if (kind === 'screen' && grant.profileId !== (screenProfileFallbacks(askedProfileId)[0] ?? '')) lowered += 1;
    // A grant counts against the budget at once, before its stream shows up.
    note();
  }

  /** The minute so far; the next one starts from what is running now. */
  function take(): MediaMinute {
    note();
    const list = Array.from(rooms());
    const minute: MediaMinute = {
      screensMax: peak.screens,
      camerasMax: peak.cameras,
      videoMbpsMax: peak.bps / 1_000_000,
      videoBudgetMbps: limits.budgetBps > 0 ? videoBudgetBps(list, limits) / 1_000_000 : null,
      lowered,
      refused
    };
    peak = current();
    lowered = 0;
    refused = 0;
    return minute;
  }

  return { note, noteDecision, take };
}

export type MediaMinuteTracker = ReturnType<typeof createMediaMinute>;
