// When the landing page offers a returning guest a permanent room: after a room
// made on an earlier day, and not again for a week after "без аккаунта".

import { beforeEach, expect, test, vi } from 'vitest';
import {
  dismissPermanentRoomOffer,
  rememberGuestRoomCreated,
  shouldOfferPermanentRoom
} from '../../src/features/home/model/returning-guest';

const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime();

beforeEach(() => localStorage.clear());

test('no past room, no offer', () => {
  expect(shouldOfferPermanentRoom(at(21, 18))).toBe(false);
});

test('a room made earlier the same day is a retry, not a return', () => {
  rememberGuestRoomCreated(at(21, 9));
  expect(shouldOfferPermanentRoom(at(21, 23))).toBe(false);
});

test('a room made the day before brings the offer, even an hour before midnight', () => {
  rememberGuestRoomCreated(at(20, 23));
  expect(shouldOfferPermanentRoom(at(21, 0))).toBe(true);
});

test('going on without an account quiets the offer for a week', () => {
  rememberGuestRoomCreated(at(10, 18));
  dismissPermanentRoomOffer(at(11, 18));
  rememberGuestRoomCreated(at(11, 18));
  expect(shouldOfferPermanentRoom(at(17, 18))).toBe(false);
  expect(shouldOfferPermanentRoom(at(18, 18))).toBe(true);
});

test('without storage the offer never shows and nothing throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  try {
    rememberGuestRoomCreated(at(20, 18));
    dismissPermanentRoomOffer(at(20, 18));
    expect(shouldOfferPermanentRoom(at(21, 18))).toBe(false);
  } finally {
    vi.restoreAllMocks();
  }
});
