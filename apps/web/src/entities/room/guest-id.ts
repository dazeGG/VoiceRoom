// One random id per browser or desktop profile, kept across visits and sent
// with every voice join, including signed-in accounts. Reuse the existing
// guest key so upgrading does not change the profile's identity. This is a
// client-controlled correlation hint, never a credential or hardware id.

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
