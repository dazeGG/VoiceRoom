// The stores and domain modules of one API app, each built on first use from
// the app's pool. A test swaps in doubles through applyOverrides(); bootstrap
// opens the pool with connect(); close() ends the pool. Whenever the pool
// changes, everything built on the old one is dropped and rebuilt on next use.
//
// What the domains need from the realtime layer (rooms with their roster,
// socket fan-out) comes in through `deps`.

import { type ServerEnvelope } from '@voice-room/shared/realtime';
import pg from 'pg';
import { createDbPool } from '../platform/db/pool.ts';
import { kyselyOn } from '../platform/db/kysely.ts';
import { revokePrincipalInTransaction } from '../domains/admission/gate-credential.repository.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createRoomStore } from './room-store.ts';
import { createUserStore } from './user-store.ts';
import { createGeoLocator } from '../lib/geoip.ts';
import { createFriendStore } from './friend-store.ts';
import { createNotificationPreferencesRepository } from '../domains/notifications/notification-preferences.repository.ts';
import { createPushSubscriptionRepository } from '../domains/notifications/push-subscription.repository.ts';
import { createDeviceTokenRepository } from '../domains/notifications/device-token.repository.ts';
import { createPushService } from '../lib/push-service.ts';
import { createRuStorePushClient } from '../lib/rustore-push.ts';
import { createNativePushService } from '../domains/notifications/native-push.service.ts';
import { createPushFanout } from '../domains/notifications/push-fanout.ts';
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
import type { ActiveBanRecord } from '../domains/moderation/active-ban.repository.ts';
import { createCursorCodec } from '../platform/cursor-codec.ts';
import {
  DEFAULT_MEDIA_STORAGE_DIR,
  readRuStorePushConfig,
  resolveCursorHmacKeys,
  resolveIpKeySecret,
  type PushConfig,
  type RuStorePushConfig
} from './config.ts';
import { createIpKey, type IpKeyOf } from '../lib/ip-key.ts';
import { createStaffRepository } from '../domains/staff/staff.repository.ts';
import { standIn, type StoreOverrides } from './store-overrides.ts';
export type { Fake, StoreOverrides } from './store-overrides.ts';
import { createHistoryModule } from '../domains/messaging/history.module.ts';
import { createReactionsModule } from '../domains/messaging/reactions.module.ts';
import { createPinsModule } from '../domains/messaging/pins.module.ts';
import { createNotificationsModule } from '../domains/notifications/notifications.module.ts';
import { createModerationModule } from '../domains/moderation/moderation.module.ts';
import { createCallFeedbackRepository } from '../domains/feedback/call-feedback.repository.ts';
import { createReportRepository } from '../domains/reports/report.repository.ts';
import { createVoiceSessionRepository, type DescribeAddress } from '../domains/rooms/voice-session.repository.ts';
import { createActivityRepository } from '../domains/account/activity.repository.ts';
import { createProductSnapshotRepository } from '../domains/ops/product-snapshot.repository.ts';
import { createSystemSnapshotRepository } from '../domains/ops/system-snapshot.repository.ts';
import { createAdminStatsRepository } from '../domains/admin/admin-stats.repository.ts';
import { createAdminAccountsRepository } from '../domains/admin/admin-accounts.repository.ts';
import { createAdminRoomsRepository } from '../domains/admin/admin-rooms.repository.ts';
import { createAdminActionRepository } from '../domains/admin/admin-action.repository.ts';
import { createAccountStandingRepository } from '../domains/account/account-standing.repository.ts';
import { createMediaModule } from '../domains/media/media.module.ts';
import { createMembershipModule, type MembershipModule } from '../domains/membership/membership.module.ts';
import type { EvictionType } from '../domains/rooms/peer-eviction.ts';
import type { LiveRoom, PresencePeer } from '../domains/rooms/room-views.ts';
import type { GatePrincipalPeer } from '../domains/admission/gate-principal.ts';
import type { ConnectionRegistry } from '../realtime/registry.ts';
import type { createMessageProjection } from '../domains/messaging/message-projection.ts';

type Logger = { error(...args: unknown[]): void; warn(...args: unknown[]): void };
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
  /** Where avatars and preview images live; defaults to the API's uploads folder. */
  UPLOADS_DIR?: string;
  /** VAPID settings for web push; read from the process environment when absent. */
  PUSH?: PushConfig;
  /** Push to the Android app through RuStore; off when absent. */
  RUSTORE_PUSH?: RuStorePushConfig;
  /** The oldest Android app a ring push still reaches; no bound when absent or empty. */
  ANDROID_MIN_VERSION?: string;
  /** Where uploaded chat media lives; defaults to /data/media. */
  MEDIA_STORAGE_DIR?: string;
  /** Uploads pause below this much free space; defaults to 2 GiB. */
  MEDIA_MIN_FREE_BYTES?: number;
};

// What the registry needs from the realtime layer.
export type ServiceRegistryDeps = {
  getRoom: (roomId: string) => Promise<Room | null>;
  findRoomBan: (
    roomId: string,
    userId: string | null | undefined,
    ip: string | null | undefined
  ) => Promise<ActiveBanRecord | null>;
  /** Sends a server event to every socket of an account; answers how many took it. */
  sendToUser: (userId: string, envelope: ServerEnvelope) => number;
  attachMediaProjectionMany: ReturnType<typeof createMessageProjection>['projectMediaMany'];
  disconnectModeratedPeer: (
    room: Room,
    peer: PresencePeer,
    type: EvictionType,
    options: { gateAlreadyRevoked?: boolean }
  ) => Promise<unknown>;
  liveKitGatePrincipalForPeer: (roomId: string, peer: GatePrincipalPeer) => unknown;
  getLiveKitConfig: () => LiveKitConfig;
  roomMembershipPresenceSnapshot: (roomId: string) => ReturnType<ConnectionRegistry['presenceSnapshot']>;
  broadcastRoomLinkPreview: (input: { roomId: string; messageId: string }) => Promise<unknown>;
  broadcastDirectLinkPreview: (input: { messageId: string; senderId: string; recipientId: string }) => Promise<unknown>;
  /** The app's room runtime; the app starts it before anything reaches here. */
  roomRuntime: () => { broadcastRoomDetail(roomId: string, envelope: ServerEnvelope): void };
};

type LiveKitCredentials = NonNullable<ReturnType<typeof createLiveKitProvider>>;

/** What a query answers while the app has no database: the route fails with 503. */
export function databaseUnavailable(): Error {
  return Object.assign(new Error('No PostgreSQL pool is installed'), { statusCode: 503 });
}
const missingPool = () => Promise.reject(databaseUnavailable());

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
    UPLOADS_DIR,
    PUSH,
    RUSTORE_PUSH = readRuStorePushConfig({}),
    MEDIA_STORAGE_DIR = DEFAULT_MEDIA_STORAGE_DIR,
    MEDIA_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
  } = config;
  const { getRoom, findRoomBan } = deps;
  const broadcastRoomDetail = (roomId: string, envelope: ServerEnvelope) =>
    deps.roomRuntime().broadcastRoomDetail(roomId, envelope);

  let pool: pg.Pool | null = null;
  // The logger connect() was given: the push service built on its pool reports through it.
  let poolLogger: Logger | undefined;
  // Whether pending room invitations expire: a friends fake decides by having
  // expirePendingInvites (null: none was given), the real store whenever a pool is installed.
  let fakeFriendsExpireInvites: boolean | null = null;
  // Everything the registry built, so that a new pool drops all of it at once.
  const built: Array<{ drop(): void }> = [];

  /**
   * A value built on first use and kept until the pool changes; a test may set
   * its own, which stays until it sets another. A build that answers null
   * (LiveKit off, no gate secret) is tried again on the next use.
   */
  function cached<T>(build: () => T) {
    let value: { current: T } | null = null;
    let override: { current: NonNullable<T> } | null = null;
    const entry = {
      get(): T {
        if (override) return override.current;
        if (value) return value.current;
        const next = build();
        if (next !== null) value = { current: next };
        return next;
      },
      set(next: T | null | undefined): void {
        override = next === null || next === undefined ? null : { current: next };
      },
      drop(): void {
        value = null;
      },
      overridden: (): boolean => override !== null,
      /** The value if something built or set it, without building it. */
      peek: (): T | undefined => (override ?? value)?.current
    };
    built.push(entry);
    return entry;
  }

  /**
   * A service on the pool: null while none is installed (a test on fakes)
   * unless a test set one. require() builds it anyway, and its queries then
   * fail with 503 internal_error.
   */
  function pooled<T>(build: (pool: pg.Pool) => T) {
    const entry = cached(() => build(requirePool()));
    return {
      get: (): T | null => (pool || entry.overridden() ? entry.get() : null),
      require: (): T => entry.get(),
      set: (next: T | null | undefined) => entry.set(next)
    };
  }

  function dropBuilt(): void {
    for (const entry of built) entry.drop();
  }

  /** The process's one PostgreSQL pool, or null while none is installed (tests on fakes). */
  function getPool(): pg.Pool | null {
    return pool;
  }

  // Apps built on fakes still construct the services they do not fake; those
  // only fail once they actually reach for the database. This pool never
  // connects: both ways in reject.
  const unconnectedPool: pg.Pool = Object.assign(new pg.Pool(), { query: missingPool, connect: missingPool });
  function requirePool(): pg.Pool {
    return pool ?? unconnectedPool;
  }

  // Built on first use: the secret comes from the configured cursor keys. Stays
  // in voice, room creators and guest bans all keep this key, never the address.
  let ipKey: IpKeyOf | null = null;
  const ipKeyOf: IpKeyOf = (ip) =>
    (ipKey ??= createIpKey(resolveIpKeySecret({ fallbackGateSecret: LIVEKIT_GATE_SECRET })))(ip);

  const activeBans = pooled((pool) => createActiveBanService({ pool, ipKeyOf }));
  const roomStore = cached(() =>
    createRoomStore({
      pool: requirePool(),
      roomIdleTtlMs: ROOM_IDLE_TTL_MS,
      ipKeyOf,
      bans: () => activeBans.require()
    })
  );
  const userStore = cached(() => createUserStore({ pool: requirePool(), sessionTtlMs: SESSION_TTL_MS }));
  const friendStore = cached(() => createFriendStore({ pool: requirePool() }));
  const notificationPreferences = cached(() => createNotificationPreferencesRepository({ pool: requirePool() }));
  const pushSubscriptions = cached(() =>
    createPushSubscriptionRepository({ pool: requirePool(), maxSubscriptionsPerUser: MAX_PUSH_SUBSCRIPTIONS_PER_USER })
  );
  const deviceTokens = cached(() =>
    createDeviceTokenRepository({ pool: requirePool(), maxTokensPerUser: MAX_PUSH_SUBSCRIPTIONS_PER_USER })
  );
  const pushService = cached(() =>
    createPushService({ store: pushSubscriptions.get(), config: PUSH, logger: poolLogger })
  );
  const nativePush = cached(() =>
    createNativePushService({
      config: RUSTORE_PUSH,
      tokens: () => deviceTokens.get(),
      client: createRuStorePushClient(RUSTORE_PUSH),
      logger: poolLogger,
      minVersion: config.ANDROID_MIN_VERSION ?? ''
    })
  );
  // Web Push and the Android app: what the dispatch sends a push through.
  const pushDelivery = cached(() => createPushFanout(() => [{ name: 'web', ...pushService.get() }, nativePush.get()]));
  // Not on the pool: the reader of the GeoIP file is opened once.
  let geoLocator: ReturnType<typeof createGeoLocator> | null = null;
  const getGeoLocator = () => (geoLocator ??= createGeoLocator({ databasePath: GEOIP_DB_PATH }));
  // An address becomes its keyed hash and its city; the address itself is never kept.
  const describeAddress: DescribeAddress = async (ip) => ({
    ipKey: ipKeyOf(ip),
    location: await getGeoLocator()
      .locate(ip)
      .catch(() => '')
  });
  const avatarStorage = cached(() => createAvatarStorage({ uploadsDir: UPLOADS_DIR }));
  const linkPreviewStorage = cached(() => createLinkPreviewStorage({ uploadsDir: UPLOADS_DIR }));

  const messageService = cached(() =>
    createMessageService({
      directMessages: createDirectMessageRepository({ store: friendStore.get() }),
      roomMessages: createRoomMessageRepository({ store: roomStore.get() }),
      visibility: createMessageVisibilityService()
    })
  );
  const history = cached(() =>
    createHistoryModule({
      pool: requirePool(),
      cursorCodec: cursorCodec('history'),
      projectMediaMany: deps.attachMediaProjectionMany,
      canReadRoom: (roomId, userId) => roomStore.get().canUserReadRoomChat(roomId, userId)
    })
  );
  const credentialBoundary = cached(() =>
    createGateCredentialBoundary({
      store: roomStore.get(),
      secret: LIVEKIT_GATE_SECRET,
      credentialTtlSeconds: LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS
    })
  );
  const liveKitCredentials = cached(() =>
    createLiveKitProvider({
      boundary: credentialBoundary.get(),
      livekit: deps.getLiveKitConfig(),
      tokenTtlSeconds: LIVEKIT_TOKEN_TTL_SECONDS
    })
  );

  const accountDeletions = pooled((pool) => createAccountDeletionRepository({ pool }));
  const reportRepository = pooled((pool) => createReportRepository({ pool }));
  const callFeedback = pooled((pool) => createCallFeedbackRepository({ pool }));
  const voiceSessions = pooled((pool) => createVoiceSessionRepository({ pool, describeAddress }));
  const activity = pooled((pool) => createActivityRepository({ pool }));
  const productSnapshots = pooled((pool) => createProductSnapshotRepository({ pool }));
  const systemSnapshots = pooled((pool) => createSystemSnapshotRepository({ pool }));
  const adminStats = pooled((pool) => createAdminStatsRepository({ pool }));
  const adminAccounts = pooled((pool) => createAdminAccountsRepository({ pool }));
  const adminRooms = pooled((pool) => createAdminRoomsRepository({ pool }));
  const adminActions = pooled((pool) => createAdminActionRepository({ pool }));
  const staffRepository = pooled((pool) => createStaffRepository({ pool }));
  const accountStanding = pooled((pool) => createAccountStandingRepository({ pool }));
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
      sendToUser: (userId, envelope) => deps.sendToUser(userId, envelope)
    })
  );
  const pins = pooled((pool) =>
    createPinsModule({ pool, roomExists: async (roomId) => Boolean(await getRoom(roomId)), broadcastRoomDetail })
  );
  const notifications = pooled((pool) =>
    createNotificationsModule({
      pool,
      cursorCodec: history.get().cursorCodec,
      activeBans: activeBans.require(),
      notificationPreferences: notificationPreferences.get()
    })
  );
  const moderation = pooled((pool) =>
    createModerationModule({
      pool,
      cursorCodec: history.get().cursorCodec,
      maxActiveBans: MAX_ROOM_BANS,
      ipKeyOf,
      revokeGatePrincipal: (client, input) => revokePrincipalInTransaction(kyselyOn(client), input),
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
      isBanned: (input) => activeBans.require().isBanned(input)
    })
  );
  const memberships = pooled<MembershipModule>((pool) =>
    createMembershipModule({
      pool,
      cursorCodec: cursorCodec('membership'),
      // The membership service only tests the ban for truthiness.
      isBanned: async ({ roomId, userId, ip }) => Boolean(await findRoomBan(roomId, userId, ip)),
      presenceSnapshot: deps.roomMembershipPresenceSnapshot
    })
  );
  const linkPreviewRepository = pooled((pool) => createLinkPreviewRepository({ pool }));
  const linkPreviews = pooled(() =>
    createLinkPreviewService({
      repository: linkPreviewRepository.require(),
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
   * Test doubles, as createApp applies them; everything built on the stores is
   * rebuilt on next use. Returns whether the room store changed (the in-memory
   * roster then belongs to the old one).
   */
  // A fake has only what its test reaches; anything else fails loudly there.
  function applyOverrides(options: StoreOverrides = {}): { roomStoreChanged: boolean } {
    if (options.pool) pool = options.pool;
    const roomStoreChanged = Boolean(options.store && options.store !== roomStore.peek());
    if (options.store) roomStore.set(standIn(options.store));
    if (options.users) userStore.set(standIn(options.users));
    fakeFriendsExpireInvites = options.friends ? Boolean(options.friends.expirePendingInvites) : null;
    if (options.friends) friendStore.set(standIn(options.friends));
    if (options.notifications) notificationPreferences.set(standIn(options.notifications));
    if (options.avatars) avatarStorage.set(standIn(options.avatars));
    pushSubscriptions.set(options.pushes && standIn(options.pushes));
    pushService.set(options.push && standIn(options.push));
    liveKitCredentials.set(options.liveKitCredentials && standIn<LiveKitCredentials>(options.liveKitCredentials));
    memberships.set(
      options.membershipServicesOverride && standIn<MembershipModule>(options.membershipServicesOverride)
    );
    dropBuilt();
    return { roomStoreChanged };
  }

  /**
   * Opens the process's one pool; the stores and repositories built from now on
   * share it. bootstrap calls this before it builds the app.
   */
  function connect({ databaseUrl, logger }: { databaseUrl: string; logger?: Logger }): pg.Pool {
    pool = createDbPool({ databaseUrl, logger });
    poolLogger = logger;
    dropBuilt();
    return pool;
  }

  /** Ends the installed pool and drops every store and service built on it. */
  async function close(logger: Pick<Logger, 'error'>): Promise<void> {
    const installed = pool;
    pool = null;
    dropBuilt();
    try {
      await installed?.end();
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.STORE_CLOSE_FAILED, err: error }, 'failed to close the database pool');
    }
  }

  /**
   * The services behind the database-backed routes, built even without a pool:
   * an app on fakes then answers those routes with 503 internal_error.
   */
  function routeServices() {
    return {
      memberships: memberships.require(),
      reactions: reactions.require(),
      pins: pins.require(),
      notifications: notifications.require(),
      moderation: moderation.require(),
      media: media.require()
    };
  }

  return {
    getRoomStore: () => roomStore.get(),
    getUserStore: () => userStore.get(),
    getGeoLocator,
    describeAddress,
    ipKeyOf,
    getFriendStore: () => friendStore.get(),
    getNotificationPreferences: () => notificationPreferences.get(),
    getPushSubscriptions: () => pushSubscriptions.get(),
    getPushService: () => pushService.get(),
    getDeviceTokens: () => deviceTokens.get(),
    getPushDelivery: () => pushDelivery.get(),
    getAvatarStorage: () => avatarStorage.get(),
    getLinkPreviewStorage: () => linkPreviewStorage.get(),
    getMessageService: () => messageService.get(),
    getHistoryServices: () => history.get(),
    getPool,
    getAccountDeletionRepository: () => accountDeletions.get(),
    getReportRepository: () => reportRepository.get(),
    getCallFeedbackRepository: () => callFeedback.get(),
    getVoiceSessionRepository: () => voiceSessions.get(),
    getActivityRepository: () => activity.get(),
    getProductSnapshotRepository: () => productSnapshots.get(),
    getSystemSnapshotRepository: () => systemSnapshots.get(),
    getAdminStatsRepository: () => adminStats.get(),
    getAdminAccountsRepository: () => adminAccounts.get(),
    getAdminRoomsRepository: () => adminRooms.get(),
    getAdminActionRepository: () => adminActions.get(),
    getStaffRepository: () => staffRepository.get(),
    getAccountStandingRepository: () => accountStanding.get(),
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
    getLinkPreviewRepository: () => linkPreviewRepository.get(),
    /** The friend store while pending room invitations can expire, else null. */
    invitationStore: () => ((fakeFriendsExpireInvites ?? Boolean(pool)) ? friendStore.get() : null),
    routeServices,
    applyOverrides,
    connect,
    close
  };
}
