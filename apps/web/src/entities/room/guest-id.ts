// One random id per browser, kept across visits and sent with every voice join,
// so the admin panel can tell one guest's stays from another's behind the same
// address. The API keeps it only for guests; it says nothing about the person.

import { normalizeGuestId } from '@voice-room/shared/validation';

const STORAGE_KEY = 'voice-room:guest-id';

/** This browser's guest id, made on first use; empty when storage is unavailable. */
export function guestBrowserId(): string {
  try {
    const stored = normalizeGuestId(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return '';
  }
}
