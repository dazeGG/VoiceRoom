import { fetchMe, type AuthUser } from '$lib/api/auth';
import { roomNameFor } from './account';

// App-wide auth state. `loaded` flips true once the first /auth/me resolves so
// the UI can avoid flashing the logged-out state before we know.
export const session = $state<{ loaded: boolean; user: AuthUser | null }>({
  loaded: false,
  user: null
});

let inflight: Promise<AuthUser | null> | null = null;

// Mirror the account name into the room's local name key so voice rooms open
// with the account's display name already filled in. This is not used as an
// auth oracle; /auth/me remains the only source for logged-in state.
function syncRoomName(user: AuthUser | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem('voice-room:name', roomNameFor(user));
    } else {
      localStorage.removeItem('voice-room:name');
    }
  } catch {
    // Ignore storage failures (private mode, quota); the room falls back to a guest name.
  }
}

export function setUser(user: AuthUser | null): void {
  session.user = user;
  session.loaded = true;
  syncRoomName(user);
}

export async function loadSession(force = false): Promise<AuthUser | null> {
  if (session.loaded && !force) return session.user;
  if (inflight) return inflight;

  inflight = fetchMe()
    .then((user) => {
      setUser(user);
      return user;
    })
    .catch((error) => {
      session.loaded = true;
      throw error;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearSession(): void {
  session.user = null;
  session.loaded = true;
  syncRoomName(null);
}
