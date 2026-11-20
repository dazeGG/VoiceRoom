import type { PeerSession } from '@voice-room/call/engine/core/types';
import type { CallIdentity, IdentityPort } from '@voice-room/call/engine/ports';
import { cleanGuestName } from '@voice-room/shared/validation';

const NAME_KEY = 'voice-room:meet:display-name';

function normalizeName(value: string): string {
  return value.trim() ? cleanGuestName(value) : '';
}

function createCredentials(): PeerSession {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionToken = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { peerId: crypto.randomUUID(), sessionToken };
}

interface MeetIdentity extends IdentityPort {
  displayName(): string;
  setDisplayName(name: string): void;
}

export function createMeetIdentity(getStorage: () => Storage = () => sessionStorage): MeetIdentity {
  let name = '';
  let roomId = '';
  let credentials: PeerSession | undefined;
  let revision = 0;

  try {
    name = normalizeName(getStorage().getItem(NAME_KEY) ?? '');
  } catch {
    // Storage can be disabled. The current page still has a name and credentials.
  }

  function current(): CallIdentity {
    return {
      kind: 'guest',
      profile: name ? { displayName: name, avatarAccent: '', avatarColorKey: '', avatarUrl: '' } : null
    };
  }

  function rotateCredentials(nextRoomId: string): PeerSession {
    roomId = nextRoomId;
    credentials = createCredentials();
    return credentials;
  }

  return {
    current,
    displayName: () => name,
    setDisplayName(value) {
      const nextName = normalizeName(value);
      if (name !== nextName) revision += 1;
      name = nextName;
      try {
        if (name) getStorage().setItem(NAME_KEY, name);
        else getStorage().removeItem(NAME_KEY);
      } catch {
        // The name remains in memory for this page.
      }
    },
    credentials: (nextRoomId) => (credentials && roomId === nextRoomId ? credentials : rotateCredentials(nextRoomId)),
    rotateCredentials,
    knownEntry: () => null,
    async verifyEntry() {
      const verifiedRevision = revision;
      return { identity: current(), isCurrent: () => revision === verifiedRevision };
    }
  };
}
