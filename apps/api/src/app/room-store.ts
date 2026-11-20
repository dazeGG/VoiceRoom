// The room store the app composes: one object over the room repositories for
// the registry and test overrides. Each table's queries live in its repository,
// and domain and realtime code depend on those repositories' types.

import type pg from 'pg';
import { kyselyOn, type Queryable } from '../platform/db/kysely.ts';
import { createActiveBanService, type ActiveBanService } from '../domains/moderation/active-ban.service.ts';
import { createRoomAccessRepository } from '../domains/rooms/room-access.repository.ts';
import { createRoomChatRepository } from '../domains/messaging/room-chat.repository.ts';
import { revokePrincipalInTransaction } from '../domains/admission/gate-credential.repository.ts';
import { createRoomBanRepository } from '../domains/moderation/room-ban.repository.ts';
import type { GatePrincipal } from '../domains/admission/gate-principal.ts';
import { createIpKey, type IpKeyOf } from '../lib/ip-key.ts';
import { resolveIpKeySecret } from './config.ts';
import { createCallRoomStore } from './call-room-store.ts';

// The registry passes its own address keyer; a store built with only a pool
// keys addresses with the same configured secret.
function createRoomStore({
  pool,
  roomIdleTtlMs = 15 * 60 * 1000,
  ipKeyOf,
  bans: injectedBans
}: {
  pool: pg.Pool;
  roomIdleTtlMs?: number;
  ipKeyOf?: IpKeyOf | undefined;
  /** The app's one ban service. A store built alone makes its own. */
  bans?: (() => ActiveBanService) | undefined;
}) {
  const db = kyselyOn(pool);
  let activeBanService: ActiveBanService | null = null;
  const bans = (): ActiveBanService =>
    injectedBans?.() ??
    (activeBanService ??= createActiveBanService({ pool, ipKeyOf: ipKeyOf ?? createIpKey(resolveIpKeySecret()) }));

  return {
    ...createCallRoomStore(db, roomIdleTtlMs),
    ...createRoomAccessRepository({ db, pool, bans }),
    ...createRoomChatRepository({ db, pool }),
    ...createRoomBanRepository({ pool, bans }),
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
