// localStorage that never throws. A browser that blocks site storage throws on
// the first touch of `localStorage`, and a full quota throws on write; a lost
// preference must not stop the page that wanted it.

/** The display name a guest or account last used, shared by the room and the start form. */
export const DISPLAY_NAME_STORAGE_KEY = 'voice-room:name';

/** The stored value, or null when it is missing or storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores the value; does nothing when storage is unavailable. */
export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The value lives on for this page through the caller's own state.
  }
}

/** Forgets the value; does nothing when storage is unavailable. */
export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing stored can be read back either.
  }
}
