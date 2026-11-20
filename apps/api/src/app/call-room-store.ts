import type { Database } from '../platform/db/kysely.ts';
import { createGateCredentialRepository } from '../domains/admission/gate-credential.repository.ts';
import { createServerMuteRepository } from '../domains/moderation/room-ban.repository.ts';
import { createPeerIdentityRepository } from '../domains/rooms/peer-identity.repository.ts';
import { createRoomRepository } from '../domains/rooms/room.repository.ts';

export function createCallRoomStore(db: Database, roomIdleTtlMs: number) {
  return {
    ...createRoomRepository({ db, roomIdleTtlMs }),
    ...createPeerIdentityRepository({ db }),
    ...createGateCredentialRepository({ db }),
    ...createServerMuteRepository({ db })
  };
}
