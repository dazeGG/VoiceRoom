// What went on in a call, in order, for its page: the comings and goings and
// the changes of level are read from its stays; screens, cameras and the
// computer's overload are what the stays kept (voice_call_events).

import type { CallEvent, VoiceMinute } from '@voice-room/shared/contracts/admin';
import type { NetworkLevel, NetworkPoint } from '@voice-room/shared/contracts/rooms';
import type { StayEvent } from '../rooms/voice-session.repository.ts';

export interface EventfulStay {
  id: string;
  joinedAt: number;
  /** Null for a seat still held. */
  leftAt: number | null;
  minutes: readonly VoiceMinute[];
  network?: readonly NetworkPoint[];
}

/** The moments a stay's voice went to another level; a minute nothing is known of changes nothing. */
function levelChanges({ minutes, network = [] }: EventfulStay): { at: number; level: NetworkLevel }[] {
  const steps = minutes.length
    ? minutes.flatMap((minute) => (minute.level ? [{ at: minute.at, level: minute.level }] : []))
    : network;
  const changes: { at: number; level: NetworkLevel }[] = [];
  let last: NetworkLevel = 'good';
  for (const { at, level } of steps) {
    if (level !== last) changes.push({ at, level });
    last = level;
  }
  return changes;
}

export function callEvents(
  stays: readonly EventfulStay[],
  kept: ReadonlyMap<string, readonly StayEvent[]>
): CallEvent[] {
  const events: CallEvent[] = [];
  for (const stay of stays) {
    events.push({ at: stay.joinedAt, kind: 'join', stayId: stay.id });
    if (stay.leftAt !== null) events.push({ at: stay.leftAt, kind: 'leave', stayId: stay.id });
    for (const { at, level } of levelChanges(stay)) {
      events.push({ at, kind: 'network', stayId: stay.id, detail: level });
    }
    for (const { at, kind } of kept.get(stay.id) ?? []) events.push({ at, kind, stayId: stay.id });
  }
  // A stable sort keeps a stay's own order among events of the same moment.
  return events.sort((a, b) => a.at - b.at);
}
