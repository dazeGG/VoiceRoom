import type { RoomAccount, RoomCall, RoomStay, VoiceMinute } from '@voice-room/shared/contracts/admin';
import type { NetworkPoint } from '@voice-room/shared/contracts/rooms';
import { seatMatches, type CallOriginFilters } from './call-filters.ts';

export const nameOf = (account: RoomAccount) => account.displayName || account.login;

export type Seat = Pick<RoomStay, 'client' | 'os' | 'browser' | 'guestId' | 'clientId' | 'ipKey' | 'location'>;

/** The address keys more than one of these came from: the same IP. */
export function sharedIpKeys(seats: readonly { key: string; ipKey: string | null }[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const seat of seats) {
    if (!seat.ipKey) continue;
    const keys = owners.get(seat.ipKey) ?? new Set<string>();
    keys.add(seat.key);
    owners.set(seat.ipKey, keys);
  }
  return new Set([...owners].filter(([, keys]) => keys.size > 1).map(([ipKey]) => ipKey));
}

/** Someone in a call: their stays (one, or more if they came back) under one name. */
export interface CallPerson {
  key: string;
  account: RoomAccount | null;
  guestName: string | null;
  /** The latest stay's seat: where they last came from. */
  seat: Seat;
  /** The stays that make them up. */
  stayIds: string[];
  /** Each stay with its voice minutes, or the network changes of an older one. */
  spans: { from: number; to: number; network: NetworkPoint[]; minutes: VoiceMinute[] }[];
  /** Time in the call, the gaps between their stays left out. */
  total: number;
}

/** The same account, the same guest browser or else the same guest name is one person. */
export function personKey(stay: RoomStay): string {
  if (stay.account) return `a:${stay.account.id}`;
  if (stay.guestId) return `g:${stay.guestId}`;
  if (stay.guestName) return `n:${stay.guestName}`;
  return `s:${stay.id}`;
}

export function peopleOf(call: Pick<RoomCall, 'stays'>): CallPerson[] {
  const people = new Map<string, CallPerson>();
  for (const stay of call.stays) {
    const key = personKey(stay);
    const span = { from: stay.joinedAt, to: stay.leftAt, network: stay.network ?? [], minutes: stay.minutes ?? [] };
    const known = people.get(key);
    if (known) {
      known.stayIds.push(stay.id);
      known.spans.push(span);
      known.total += span.to - span.from;
      known.seat = stay;
    } else {
      people.set(key, {
        key,
        account: stay.account,
        guestName: stay.guestName,
        seat: stay,
        stayIds: [stay.id],
        spans: [span],
        total: span.to - span.from
      });
    }
  }
  return [...people.values()];
}

/** The people of a call one of whose stays the history's filters describe. */
export function matchedPeople(call: Pick<RoomCall, 'stays'>, filters: CallOriginFilters): Set<string> {
  return new Set(call.stays.filter((stay) => seatMatches(stay, filters)).map(personKey));
}
