// The room store the app composes: one object over the room repositories, the
// shape route modules, the realtime layer and test fakes know. Each table's
// queries live in its repository.

import type pg from 'pg';
import { kyselyOn, type Queryable } from '../platform/db/kysely.ts';
import { createActiveBanService, type ActiveBanService } from '../domains/moderation/active-ban.service.ts';
import { createRoomRepository } from '../domains/rooms/room.repository.ts';
import { createRoomAccessRepository } from '../domains/rooms/room-access.repository.ts';
import { createPeerIdentityRepository } from '../domains/rooms/peer-identity.repository.ts';
import { createRoomChatRepository } from '../domains/messaging/room-chat.repository.ts';
import {
  createGateCredentialRepository,
  revokePrincipalInTransaction
} from '../domains/admission/gate-credential.repository.ts';
import { createRoomBanRepository, createServerMuteRepository } from '../domains/moderation/room-ban.repository.ts';
import type { GatePrincipal } from '../domains/admission/admission.service.ts';

export type { GatePrincipal };
export type { RoomCreation, RoomRelationship, StoredRoom } from '../domains/rooms/room.repository.ts';
export type { AppendRoomMessageInput, StoredRoomMessage } from '../domains/messaging/room-chat.repository.ts';
export type { PrincipalEpoch } from '../domains/admission/gate-credential.repository.ts';

function createRoomStore({ pool, roomIdleTtlMs = 15 * 60 * 1000 }: { pool: pg.Pool; roomIdleTtlMs?: number }) {
  const db = kyselyOn(pool);
  let activeBanService: ActiveBanService | null = null;
  const bans = (): ActiveBanService => (activeBanService ??= createActiveBanService({ pool }));

  const gate = createGateCredentialRepository({ db });

  return {
    ...createRoomRepository({ db, roomIdleTtlMs }),
    ...createRoomAccessRepository({ db, pool, bans }),
    ...createPeerIdentityRepository({ db }),
    ...createRoomChatRepository({ db, pool }),
    ...gate,
    ...createRoomBanRepository({ pool, bans }),
    ...createServerMuteRepository({ db }),
    /** For services that revoke inside their own pg transaction. */
    revokeLiveKitGatePrincipalInTransaction(
      client: Queryable,
      input: { principal: GatePrincipal; roomId: string; now?: number }
    ) {
      return revokePrincipalInTransaction(kyselyOn(client), input);
    }
  };
}

export { createRoomStore };
export type RoomStore = ReturnType<typeof createRoomStore>;
