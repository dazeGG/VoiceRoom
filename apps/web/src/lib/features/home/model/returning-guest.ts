// A guest room is deleted minutes after everyone leaves, so a guest who comes
// back makes a new room and sends a new link every time. When a guest who made
// a room on an earlier day makes another one, the landing page offers an
// account first: its permanent room keeps one link for good. Without storage
// (private mode) the browser has no past, and the offer never shows.

export const GUEST_ROOM_CREATED_KEY = 'voice-room:guest-room-created-at';
export const PERMANENT_ROOM_OFFER_DISMISSED_KEY = 'voice-room:permanent-room-offer-dismissed-at';

// "Без аккаунта" quiets the offer for a week, not forever: the link keeps dying.
const OFFER_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

function readTime(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeTime(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    // Storage can be unavailable (private mode); the offer then never shows.
  }
}

const localDay = (at: number): string => new Date(at).toDateString();

export function rememberGuestRoomCreated(now: number = Date.now()): void {
  writeTime(GUEST_ROOM_CREATED_KEY, now);
}

export function dismissPermanentRoomOffer(now: number = Date.now()): void {
  writeTime(PERMANENT_ROOM_OFFER_DISMISSED_KEY, now);
}

/** A room made earlier today is a retry, not a return, and gets no offer. */
export function shouldOfferPermanentRoom(now: number = Date.now()): boolean {
  const createdAt = readTime(GUEST_ROOM_CREATED_KEY);
  if (!createdAt || createdAt > now || localDay(createdAt) === localDay(now)) return false;
  return now - readTime(PERMANENT_ROOM_OFFER_DISMISSED_KEY) >= OFFER_QUIET_MS;
}
