// The stores and domain modules of one API app, each built on first use from
// the app's pool. A test swaps in doubles through applyOverrides(); bootstrap
// opens the pool with connect() and installs what it builds from process
// configuration with install(); close() ends the pool.
//
// What the domains need from the realtime layer (rooms with their roster,
// socket fan-out) comes in through `deps`.

import { type ServerEnvelope } from '@voice-room/shared/realtime';
import type pg from 'pg';
import { createDbPool } from '../platform/db/pool.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createRoomStore } from '../lib/room-store.ts';
import { createUserStore } from '../lib/user-store.ts';
import { createGeoLocator } from '../lib/geoip.ts';
import { createFriendStore } from '../lib/friend-store.ts';
import { createNotificationStore } from '../lib/notification-store.ts';
import { createPushStore } from '../lib/push-store.ts';
import { createPushService } from '../lib/push-service.ts';
import { createAvatarStorage } from '../lib/avatar-storage.ts';
import { createLinkPreviewFetcher } from '../lib/link-preview-fetcher.ts';
import { processLinkPreviewImage } from '../lib/link-preview-image.ts';
import { createLinkPreviewStorage } from '../lib/link-preview-storage.ts';
import { createLinkPreviewRepository } from '../domains/link-previews/link-preview.repository.ts';
import { createLinkPreviewService } from '../domains/link-previews/link-preview.service.ts';
import { createAccountDeletionRepository } from '../domains/account/account-deletion.repository.ts';
import { createGateCredentialBoundary, createLiveKitProvider } from '../domains/admission/admission.module.ts';
import { createDirectMessageRepository } from '../domains/messaging/direct-message.repository.ts';
import { createMessageService } from '../domains/messaging/message.service.ts';
import { createMessageIdempotencyRepository } from '../domains/messaging/message-idempotency.repository.ts';
import { createMessageOutboxRepository } from '../domains/messaging/message-outbox.repository.ts';
import { createMessageVisibilityService } from '../domains/messaging/message-visibility.service.ts';
import { createRoomMessageRepository } from '../domains/messaging/room-message.repository.ts';
import { createActiveBanService } from '../domains/moderation/active-ban.service.ts';
import { createCursorCodec } from '../platform/cursor-codec.ts';
import { resolveCursorHmacKeys } from './config.ts';
import type { StoreOverrides } from './store-overrides.ts';
export type { Fake, StoreOverrides } from './store-overrides.ts';
import { createHistoryModule } from '../domains/messaging/history.module.ts';
import { createReactionsModule } from '../domains/messaging/reactions.module.ts';
import { createPinsModule } from '../domains/messaging/pins.module.ts';
import { createNotificationsModule } from '../domains/notifications/notifications.module.ts';
import { createModerationModule } from '../domains/moderation/moderation.module.ts';
import { createMediaModule } from '../domains/media/media.module.ts';
import { createMembershipModule, type MembershipModule } from '../domains/membership/membership.module.ts';
import type { EvictionType } from '../domains/rooms/peer-eviction.ts';
import type { LiveRoom, PresencePeer } from '../domains/rooms/room-views.ts';
import type { GatePrincipalPeer } from '../domains/admission/gate-principal.ts';
import type { buildRoomMembershipPresenceSnapshot } from '../realtime/registry.ts';
import type { createMessageProjection } from '../domains/messaging/message-projection.ts';

type Logger = { error(...args: unknown[]): void };
type LiveKitConfig = { enabled: boolean; apiKey: string; apiSecret: string; gateUrl: string };
// The stored room with its presence roster attached.
type Room = LiveRoom;

export type ServiceRegistryConfig = {
  ROOM_IDLE_TTL_MS: number;
  SESSION_TTL_MS: number;
  GEOIP_DB_PATH: string;
  LIVEKIT_GATE_SECRET: string;
  LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS: number;
  LIVEKIT_TOKEN_TTL_SECONDS: number;
  MAX_ROOM_BANS: number;
  MAX_PUSH_SUBSCRIPTIONS_PER_USER: number;
  LINK_PREVIEWS_ENABLED: boolean;
  /** Where uploaded chat media lives; defaults to /data/media. */
  MEDIA_STORAGE_DIR?: string;
  /** Uploads pause below this much free space; defaults to 2 GiB. */
  MEDIA_MIN_FREE_BYTES?: number;
};

// What the registry needs from the realtime layer.
export type ServiceRegistryDeps = {
  readinessProvider: { getSnapshot(): { replicaConsensus?: boolean } | null | undefined };
  release250FeatureEnabled: (name: string) => boolean;
  getRoom: (roomId: string) => Promise<Room | null>;
  findRoomBan: (roomId: string, userId: string | null | undefined, ip: string | null | undefined) => Promise<unknown>;
  /** Sends a server event to every socket of an account; answers how many took it. */
  sendToUser: (userId: string, envelope: ServerEnvelope) => number;
  attachMediaProjection: ReturnType<typeof createMessageProjection>['projectMedia'];
  disconnectModeratedPeer: (
    room: Room,
    peer: PresencePeer,
    type: EvictionType,
    options: { gateAlreadyRevoked?: boolean }
  ) => Promise<unknown>;
  liveKitGatePrincipalForPeer: (roomId: string, peer: GatePrincipalPeer) => unknown;
  getLiveKitConfig: () => LiveKitConfig;
  roomMembershipPresenceSnapshot: (roomId: string) => ReturnType<typeof buildRoomMembershipPresenceSnapshot>;
  broadcastRoomLinkPreview: (input: { roomId: string; messageId: string }) => Promise<unknown>;
  broadcastDirectLinkPreview: (input: { messageId: string; senderId: string; recipientId: string }) => Promise<unknown>;
  roomRuntime: () => { broadcastRoomDetail(roomId: string, envelope: ServerEnvelope): void } | null | undefined;
};

type RoomStore = ReturnType<typeof createRoomStore>;
type LiveKitCredentials = NonNullable<ReturnType<typeof createLiveKitProvider>>;
const missingPool = () => Promise.reject(new Error('No PostgreSQL pool is installed'));
const MISSING_POOL = { query: missingPool, connect: missingPool } as unknown as pg.Pool;

/** A value built on first use; a test may set it, and a reset rebuilds it. */
function lazy<T>(build: () => T) {
  let value: T | undefined;
  let built = false;
  return {
    get(): T {
      if (!built) {
        value = build();
        built = true;
      }
      return value as T;
    },
    set(next: T): void {
      value = next;
      built = true;
    },
    reset(): void {
      value = undefined;
      built = false;
    },
    /** The value if something built or set it, without building it. */
    peek: (): T | undefined => value
  };
}

type Pooled<T> = { get(): T | null; set(next: T | null | undefined): void; reset(): void };

/**
 * A value that may not be available yet (LiveKit off, no gate secret): it is
 * rebuilt on every use until it exists, then kept.
 */
function once<T>(build: () => T | null): Pooled<T> {
  let value: T | null = null;
  return {
    get: () => (value ??= build()),
    set(next) {
      value = next ?? null;
    },
    reset() {
      value = null;
    }
  };
}

export function createServiceRegistry(config: ServiceRegistryConfig, deps: ServiceRegistryDeps) {
  const {
    ROOM_IDLE_TTL_MS,
    SESSION_TTL_MS,
    GEOIP_DB_PATH,
    LIVEKIT_GATE_SECRET,
    LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS,
    LIVEKIT_TOKEN_TTL_SECONDS,
    MAX_ROOM_BANS,
    MAX_PUSH_SUBSCRIPTIONS_PER_USER,
    LINK_PREVIEWS_ENABLED,
    MEDIA_STORAGE_DIR = '/data/media',
    MEDIA_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
  } = config;
  const { readinessProvider, release250FeatureEnabled, getRoom, findRoomBan } = deps;
  const broadcastRoomDetail = (roomId: string, envelope: ServerEnvelope) =>
    deps.roomRuntime()?.broadcastRoomDetail(roomId, envelope);

  let pool: pg.Pool | null = null;
  let friendStoreInviteExpiryEnabled = false;

  /** The process's one PostgreSQL pool, or null while none is installed (tests on fakes). */
  function getPool(): pg.Pool | null {
    return pool;
  }

  // Apps built on fakes still construct the services they do not fake; those
  // only fail once they actually reach for the database.
  function requirePool(): pg.Pool {
    return pool ?? MISSING_POOL;
  }

  /** A service that exists only while a pool is installed; a test may set one. */
  function pooled<T>(build: (pool: pg.Pool) => T): Pooled<T> {
    let value: T | null = null;
    return {
      get() {
        if (value) return value;
        if (!pool) return null;
        value = build(pool);
        return value;
      },
      set(next) {
        value = next ?? null;
      },
      reset() {
        value = null;
      }
    };
  }

  const roomStore = lazy(() => createRoomStore({ pool: requirePool(), roomIdleTtlMs: ROOM_IDLE_TTL_MS }));
  const userStore = lazy(() => createUserStore({ pool: requirePool(), sessionTtlMs: SESSION_TTL_MS }));
  const friendStore = lazy(() => createFriendStore({ pool: requirePool() }));
  const notificationStore = lazy(() => createNotificationStore({ pool: requirePool() }));
  const pushStore = lazy(() =>
    createPushStore({ pool: requirePool(), maxSubscriptionsPerUser: MAX_PUSH_SUBSCRIPTIONS_PER_USER })
  );
  const pushService = lazy(() => createPushService({ store: pushStore.get() }));
  const geoLocator = lazy(() => createGeoLocator({ databasePath: GEOIP_DB_PATH }));
  const avatarStorage = lazy(() => createAvatarStorage());
  const linkPreviewStorage = lazy(() => createLinkPreviewStorage());

  const messageService = lazy(() =>
    createMessageService({
      directMessages: createDirectMessageRepository({ store: friendStore.get() }),
      roomMessages: createRoomMessageRepository({ store: roomStore.get() }),
      visibility: createMessageVisibilityService()
    })
  );
  const history = lazy(() =>
    createHistoryModule({
      pool: requirePool(),
      cursorCodec: cursorCodec('history'),
      projectMedia: deps.attachMediaProjection,
      canReadRoom: (roomId, userId) => roomStore.get().canUserReadRoomChat(roomId, userId)
    })
  );
  const credentialBoundary = once(() =>
    createGateCredentialBoundary({
      store: roomStore.get(),
      secret: LIVEKIT_GATE_SECRET,
      credentialTtlSeconds: LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS
    })
  );
  const liveKitCredentials = once(() =>
    createLiveKitProvider({
      boundary: credentialBoundary.get(),
      livekit: deps.getLiveKitConfig(),
      tokenTtlSeconds: LIVEKIT_TOKEN_TTL_SECONDS
    })
  );

  const accountDeletions = pooled((pool) => createAccountDeletionRepository({ pool }));
  const activeBans = pooled((pool) => createActiveBanService({ pool }));
  const delivery = pooled((pool) => ({
    idempotency: createMessageIdempotencyRepository(),
    outbox: createMessageOutboxRepository({ pool })
  }));
  const reactions = pooled((pool) =>
    createReactionsModule({
      pool,
      cursorCodec: history.get().cursorCodec,
      roomExists: async (roomId) => Boolean(await getRoom(roomId)),
      roomMessageExists: async (roomId, messageId) =>
        Boolean(await messageService.get().room.getMessage(roomId, messageId)),
      directMessageVisible: async (userId, peerId, messageId) =>
        Boolean(await messageService.get().direct.getMessage(userId, peerId, messageId)),
      canReadRoom: (roomId, userId) => roomStore.get().canUserReadRoomChat(roomId, userId),
      canReactInRoom: (roomId, userId) => roomStore.get().canUserReactInRoom(roomId, userId),
      broadcastRoomDetail,
      sendToUser: (userId, envelope) => deps.sendToUser(userId, envelope),
      writesEnabled: () => release250FeatureEnabled('reactions')
    })
  );
  const pins = pooled((pool) =>
    createPinsModule({ pool, roomExists: async (roomId) => Boolean(await getRoom(roomId)), broadcastRoomDetail })
  );
  const notifications = pooled((pool) =>
    createNotificationsModule({
      pool,
      cursorCodec: history.get().cursorCodec,
      activeBans: activeBans.get()!,
      notificationStore: notificationStore.get()
    })
  );
  const moderation = pooled((pool) =>
    createModerationModule({
      pool,
      cursorCodec: history.get().cursorCodec,
      maxActiveBans: MAX_ROOM_BANS,
      roomStore: () => roomStore.get(),
      getRoom,
      gatePrincipalForPeer: deps.liveKitGatePrincipalForPeer,
      disconnectPeer: deps.disconnectModeratedPeer,
      broadcastRoomDetail
    })
  );
  const media = pooled((pool) =>
    createMediaModule({
      pool,
      storageDir: MEDIA_STORAGE_DIR,
      minFreeBytes: MEDIA_MIN_FREE_BYTES,
      replicaConsensus: () => readinessProvider.getSnapshot()?.replicaConsensus === true,
      isBanned: (input) => activeBans.get()!.isBanned(input)
    })
  );
  const memberships = pooled<MembershipModule>((pool) =>
    createMembershipModule({
      pool,
      cursorCodec: cursorCodec('membership'),
      // The membership service only tests the ban for truthiness.
      isBanned: ({ roomId, userId, ip }) => findRoomBan(roomId, userId, ip) as Promise<boolean>,
      presenceSnapshot: deps.roomMembershipPresenceSnapshot
    })
  );
  const linkPreviews = pooled((pool) =>
    createLinkPreviewService({
      repository: createLinkPreviewRepository({ pool }),
      fetcher: createLinkPreviewFetcher(),
      storage: linkPreviewStorage.get(),
      processImage: processLinkPreviewImage,
      onRoomPreview: deps.broadcastRoomLinkPreview,
      onDirectPreview: deps.broadcastDirectLinkPreview
    })
  );

  function cursorCodec(context: 'history' | 'membership') {
    return createCursorCodec({ keys: resolveCursorHmacKeys({ context, fallbackGateSecret: LIVEKIT_GATE_SECRET }) });
  }

  /**
   * Test doubles, as createApp applies them; the services built on the stores
   * are rebuilt on next use. Returns whether the room store changed (the
   * in-memory roster then belongs to the old one).
   */
  // A fake has only what its test reaches; anything else fails loudly there.
  function applyOverrides(options: StoreOverrides = {}): { roomStoreChanged: boolean } {
    if (options.pool) pool = options.pool;
    const roomStoreChanged = Boolean(options.store && options.store !== roomStore.peek());
    if (options.store) roomStore.set(options.store as RoomStore);
    if (options.users) userStore.set(options.users as ReturnType<typeof createUserStore>);
    friendStoreInviteExpiryEnabled = Boolean(options.friends?.expirePendingInvites);
    if (options.friends) friendStore.set(options.friends as ReturnType<typeof createFriendStore>);
    if (options.notifications)
      notificationStore.set(options.notifications as ReturnType<typeof createNotificationStore>);
    if (options.avatars) avatarStorage.set(options.avatars as ReturnType<typeof createAvatarStorage>);
    if (options.pushes) pushStore.set(options.pushes as ReturnType<typeof createPushStore>);
    else pushStore.reset();
    if (options.push) pushService.set(options.push as ReturnType<typeof createPushService>);
    else pushService.reset();
    liveKitCredentials.set(options.liveKitCredentials as LiveKitCredentials | null | undefined);
    memberships.set(options.membershipServicesOverride as MembershipModule | null | undefined);
    for (const derived of [messageService, history, credentialBoundary]) derived.reset();
    for (const derived of [reactions, pins, notifications, moderation, media, activeBans, delivery]) derived.reset();
    return { roomStoreChanged };
  }

  /**
   * Opens the process's one pool; the stores and repositories built from now on
   * share it. bootstrap calls this before it builds the app.
   */
  function connect({ databaseUrl, logger }: { databaseUrl: string; logger?: Logger }): pg.Pool {
    pool = createDbPool({ databaseUrl, logger });
    return pool;
  }

  /** What bootstrap builds with process configuration the registry does not hold. */
  function install(services: {
    pushService: ReturnType<typeof createPushService>;
    avatarStorage: ReturnType<typeof createAvatarStorage>;
    linkPreviewStorage: ReturnType<typeof createLinkPreviewStorage>;
  }): void {
    pushService.set(services.pushService);
    avatarStorage.set(services.avatarStorage);
    linkPreviewStorage.set(services.linkPreviewStorage);
    messageService.reset();
  }

  /** Ends the installed pool; every store and repository shares it. */
  async function close(logger: Logger): Promise<void> {
    const installed = pool;
    pool = null;
    memberships.reset();
    try {
      await installed?.end();
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.STORE_CLOSE_FAILED, err: error }, 'failed to close the database pool');
    }
  }

  return {
    getRoomStore: () => roomStore.get(),
    getUserStore: () => userStore.get(),
    getGeoLocator: () => geoLocator.get(),
    getFriendStore: () => friendStore.get(),
    getNotificationStore: () => notificationStore.get(),
    getPushStore: () => pushStore.get(),
    getPushService: () => pushService.get(),
    getAvatarStorage: () => avatarStorage.get(),
    getLinkPreviewStorage: () => linkPreviewStorage.get(),
    getMessageService: () => messageService.get(),
    getHistoryServices: () => history.get(),
    getPool,
    getAccountDeletionRepository: () => accountDeletions.get(),
    getReactionServices: () => reactions.get(),
    getPinServices: () => pins.get(),
    getMessageDeliveryServices: () => delivery.get(),
    getNotificationServices: () => notifications.get(),
    getModerationServices: () => moderation.get(),
    getActiveBanService: () => activeBans.get(),
    getMediaServices: () => media.get(),
    getCredentialBoundary: () => credentialBoundary.get(),
    getLiveKitCredentialProvider: () => liveKitCredentials.get(),
    getMembershipServices: () => memberships.get(),
    getLinkPreviewService: () => (LINK_PREVIEWS_ENABLED ? linkPreviews.get() : null),
    /** The friend store while pending room invitations can expire, else null. */
    invitationStore: () => (friendStoreInviteExpiryEnabled ? (friendStore.peek() ?? null) : null),
    applyOverrides,
    connect,
    install,
    close
  };
}
