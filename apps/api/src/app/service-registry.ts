// The composition root's stores and services, each built on first use and
// kept for the life of the process. createApiApp swaps in test doubles
// through applyOverrides(); bootstrap installs the database-backed stores
// through install(); close() releases what holds connections.
//
// The bodies are the ones server.ts had; what they need from the realtime
// layer (rooms, broadcasts, presence) comes in through `deps`, so nothing
// here reaches back into server.ts.
//

import type { RoomPeerMessage } from '../realtime/legacy-events.ts';
import { buildServerEnvelope, type ServerEnvelope } from '@voice-room/shared/realtime';
import crypto from 'node:crypto';
import type pg from 'pg';
import { createDbPool } from '../platform/db/pool.ts';
import { readEnvInt } from '../lib/config.ts';
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
import { recordMediaAuthorizationInvariantFailure, recordMediaPressure } from '../lib/metrics.ts';
import { createLinkPreviewRepository } from '../domains/link-previews/link-preview-repository.ts';
import { createLinkPreviewService } from '../domains/link-previews/link-preview-service.ts';
import { createAccountDeletionRepository } from '../domains/account/account-deletion-repository.ts';
import { createCredentialBoundaryService } from '../domains/admission/credential-boundary-service.ts';
import { createLiveKitCredentialProvider } from '../domains/admission/livekit-credential-provider.ts';
import { isGatePrincipal } from '../domains/admission/gate-principal.ts';
import { createMediaAccessRepository } from '../domains/media/media-access-repository.ts';
import { createMembershipRepository } from '../domains/membership/membership-repository.ts';
import { createMembershipService } from '../domains/membership/membership-service.ts';
import { createMemberDirectoryService } from '../domains/membership/member-directory-service.ts';
import { createDirectMessageRepository } from '../domains/messaging/direct-message-repository.ts';
import type { DirectMessageRepository } from '../domains/messaging/direct-message-repository.ts';
import { createDmHistoryRepository } from '../domains/messaging/dm-history-repository.ts';
import { createDmHistoryService } from '../domains/messaging/dm-history-service.ts';
import { createMessageService } from '../domains/messaging/message-service.ts';
import { createMessageReadRepository } from '../domains/messaging/message-read-repository.ts';
import { createMessageReadService } from '../domains/messaging/message-read-service.ts';
import { createMessageIdempotencyRepository } from '../domains/messaging/message-idempotency-repository.ts';
import { createMessageOutboxRepository } from '../domains/messaging/message-outbox-repository.ts';
import { createMessageVisibilityService } from '../domains/messaging/message-visibility-service.ts';
import { createRoomHistoryRepository } from '../domains/messaging/room-history-repository.ts';
import { createRoomHistoryService } from '../domains/messaging/room-history-service.ts';
import { createRoomMessageRepository } from '../domains/messaging/room-message-repository.ts';
import type { RoomMessageRepository } from '../domains/messaging/room-message-repository.ts';
import { createReplyRepository } from '../domains/messaging/reply-repository.ts';
import { createReactionRepository } from '../domains/messaging/reaction-repository.ts';
import { createReactionService } from '../domains/messaging/reaction-service.ts';
import { createReactionRealtimeAdapter } from '../domains/messaging/reaction-realtime-adapter.ts';
import { createPinRepository } from '../domains/messaging/pin-repository.ts';
import { createPinService } from '../domains/messaging/pin-service.ts';
import { createInboxRepository } from '../domains/notifications/inbox-repository.ts';
import { createMentionRepository } from '../domains/notifications/mention-repository.ts';
import { createMentionEligibilityService } from '../domains/notifications/mention-eligibility-service.ts';
import { createNotificationOutboxRepository } from '../domains/notifications/notification-outbox-repository.ts';
import { createNotificationService } from '../domains/notifications/notification-service.ts';
import { createModerationRepository } from '../domains/moderation/moderation-repository.ts';
import { createActiveBanService } from '../domains/moderation/active-ban-service.ts';
import { createModerationService } from '../domains/moderation/moderation-service.ts';
import { createMessageModerationService } from '../domains/moderation/message-moderation-service.ts';
import { createAttachmentRepository } from '../domains/media/attachment-repository.ts';
import { createMediaJobRepository } from '../domains/media/media-job-repository.ts';
import { createMediaStorage } from '../domains/media/storage.ts';
import { createMediaPressureService } from '../domains/media/media-pressure-service.ts';
import { createMediaQuotaRepository } from '../domains/media/media-quota-repository.ts';
import { createMediaQuotaService } from '../domains/media/media-quota-service.ts';
import { createMediaService } from '../domains/media/media-service.ts';
import { createMediaVisibilityService } from '../domains/media/media-visibility-service.ts';
import { createCursorCodec } from '../platform/cursor-codec.ts';
import type { EvictionType } from '../domains/rooms/peer-eviction.ts';

type Logger = { error(...args: unknown[]): void };
type LiveKitConfig = { enabled: boolean; apiKey: string; apiSecret: string; gateUrl: string };
// The in-memory room with its presence roster attached (server.ts).
type Room = any;

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
};

// What the registry needs from the realtime layer, which server.ts owns.
export type ServiceRegistryDeps = {
  readinessProvider: { getSnapshot(): { replicaConsensus?: boolean } | null | undefined };
  release250FeatureEnabled: (name: string) => boolean;
  getRoom: (roomId: string) => Promise<Room | null>;
  findRoomBan: (roomId: string, userId: string | null | undefined, ip: string | null | undefined) => Promise<unknown>;
  broadcast: (room: Room, message: RoomPeerMessage) => void;
  broadcastToUser: (userId: string, message: any) => unknown;
  attachMediaProjection: (context: 'room' | 'dm', message: any) => Promise<any>;
  disconnectModeratedPeer: (
    room: Room,
    peer: any,
    type: EvictionType,
    options: { gateAlreadyRevoked?: boolean }
  ) => Promise<unknown>;
  liveKitGatePrincipalForPeer: (roomId: string, peer: any) => unknown;
  getLiveKitConfig: () => LiveKitConfig;
  roomMembershipPresenceSnapshot: (roomId: string) => any;
  broadcastRoomLinkPreview: (input: any) => Promise<unknown>;
  broadcastDirectLinkPreview: (input: any) => Promise<unknown>;
  roomRuntime: () => { broadcastRoomDetail(roomId: string, envelope: ServerEnvelope): void } | null | undefined;
};

type HistoryServices = {
  cursorCodec: ReturnType<typeof createCursorCodec>;
  dm: ReturnType<typeof createDmHistoryService>;
  room: ReturnType<typeof createRoomHistoryService>;
  read: ReturnType<typeof createMessageReadService>;
};
type ReactionServices = {
  realtime: ReturnType<typeof createReactionRealtimeAdapter>;
  service: ReturnType<typeof createReactionService>;
};
type PinServices = { service: ReturnType<typeof createPinService> };
type MessageDeliveryServices = {
  idempotency: ReturnType<typeof createMessageIdempotencyRepository>;
  outbox: ReturnType<typeof createMessageOutboxRepository>;
};
type NotificationServices = {
  eligibility: ReturnType<typeof createMentionEligibilityService>;
  inbox: ReturnType<typeof createInboxRepository>;
  mentions: ReturnType<typeof createMentionRepository>;
  outbox: ReturnType<typeof createNotificationOutboxRepository>;
  service: ReturnType<typeof createNotificationService>;
};
type ModerationServices = {
  messageService: ReturnType<typeof createMessageModerationService>;
  repository: ReturnType<typeof createModerationRepository>;
  service: ReturnType<typeof createModerationService>;
};
type MediaServices = {
  attachments: ReturnType<typeof createAttachmentRepository>;
  jobs: ReturnType<typeof createMediaJobRepository>;
  pressure: ReturnType<typeof createMediaPressureService>;
  quota: ReturnType<typeof createMediaQuotaService>;
  service: ReturnType<typeof createMediaService>;
  storage: ReturnType<typeof createMediaStorage>;
  visibility: ReturnType<typeof createMediaVisibilityService>;
};
type MembershipServices = {
  directory: ReturnType<typeof createMemberDirectoryService>;
  repository: ReturnType<typeof createMembershipRepository>;
  service: ReturnType<typeof createMembershipService>;
};
// Test doubles and bootstrap's stores come from JavaScript callers.
/**
 * A stand-in a test supplies for a store: any subset of its methods, each
 * called with the real arguments. What a method answers is the test's to
 * choose, so a case can return just the fields it exercises.
 */
export type Fake<Store> = {
  // Declared as a method so a fake may narrow a parameter the real store
  // accepts loosely (method parameters are checked bivariantly).
  [Key in keyof Store]?: Store[Key] extends (...args: infer Args) => unknown
    ? { method(...args: Args): unknown }['method']
    : unknown;
};

/** Stores and services a test supplies instead of the database-backed ones. */
export type StoreOverrides = {
  /** A pool for the database-backed services the test does not fake. */
  pool?: pg.Pool | null;
  store?: Fake<ReturnType<typeof createRoomStore>> | null;
  users?: Fake<ReturnType<typeof createUserStore>> | null;
  friends?: Fake<ReturnType<typeof createFriendStore>> | null;
  notifications?: Fake<ReturnType<typeof createNotificationStore>> | null;
  pushes?: Fake<ReturnType<typeof createPushStore>> | null;
  push?: Fake<ReturnType<typeof createPushService>> | null;
  avatars?: Fake<ReturnType<typeof createAvatarStorage>> | null;
  liveKitCredentials?: Fake<ReturnType<typeof createLiveKitCredentialProvider>> | null;
  membershipServicesOverride?: { service?: Fake<MembershipServices['service']> } | null;
};

export function resolveCursorHmacKeys({
  context,
  env = process.env,
  fallbackGateSecret = ''
}: { context?: string; env?: NodeJS.ProcessEnv; fallbackGateSecret?: string } = {}): string {
  const configured = env.VOICE_ROOM_CURSOR_HMAC_KEYS || env.CURSOR_HMAC_KEYS || env.CURSOR_HMAC_KEY;
  if (configured) return configured;

  if (env.NODE_ENV === 'production') {
    throw new Error('VOICE_ROOM_CURSOR_HMAC_KEYS is required in production');
  }

  const liveKitGateSecret =
    typeof env.LIVEKIT_GATE_SECRET === 'string' ? env.LIVEKIT_GATE_SECRET.trim() : fallbackGateSecret;
  if (liveKitGateSecret.length >= 32) return `${liveKitGateSecret}:${context}-cursors`;

  const developmentSeed =
    context === 'membership' ? 'voice-room-development-membership' : 'voice-room-development-cursors';
  return crypto
    .createHash('sha256')
    .update(String(env.POW_SECRET || developmentSeed))
    .digest('hex');
}

const missingPool = () => Promise.reject(new Error('No PostgreSQL pool is installed'));
const MISSING_POOL = { query: missingPool, connect: missingPool } as unknown as pg.Pool;

export function createServiceRegistry(config: ServiceRegistryConfig, deps: ServiceRegistryDeps) {
  let roomStore: ReturnType<typeof createRoomStore> | null = null;
  let userStore: ReturnType<typeof createUserStore> | null = null;
  let geoLocator: ReturnType<typeof createGeoLocator> | null = null;
  let friendStore: ReturnType<typeof createFriendStore> | null = null;
  let friendStoreInviteExpiryEnabled = false;
  let notificationStore: ReturnType<typeof createNotificationStore> | null = null;
  let pushStore: ReturnType<typeof createPushStore> | null = null;
  let pushService: ReturnType<typeof createPushService> | null = null;
  let avatarStorage: ReturnType<typeof createAvatarStorage> | null = null;
  let messageService: ReturnType<typeof createMessageService<DirectMessageRepository, RoomMessageRepository>> | null =
    null;
  let historyServices: HistoryServices | null = null;
  let credentialBoundary: ReturnType<typeof createCredentialBoundaryService> | null = null;
  let liveKitCredentialProvider: ReturnType<typeof createLiveKitCredentialProvider> | null = null;
  let membershipServices: MembershipServices | null = null;
  let pool: pg.Pool | null = null;
  let reactionServices: ReactionServices | null = null;
  let pinServices: PinServices | null = null;
  let notificationServices: NotificationServices | null = null;
  let moderationServices: ModerationServices | null = null;
  let mediaServices: MediaServices | null = null;
  let activeBanService: ReturnType<typeof createActiveBanService> | null = null;
  let messageDeliveryServices: MessageDeliveryServices | null = null;
  let accountDeletionRepository: ReturnType<typeof createAccountDeletionRepository> | null = null;
  let linkPreviewStorage: ReturnType<typeof createLinkPreviewStorage> | null = null;
  let linkPreviewService: ReturnType<typeof createLinkPreviewService> | null = null;

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
    MEDIA_STORAGE_DIR = '/data/media'
  } = config;
  const { readinessProvider } = deps;
  type D = ServiceRegistryDeps;
  const release250FeatureEnabled: D['release250FeatureEnabled'] = (name) => deps.release250FeatureEnabled(name);
  const getRoom: D['getRoom'] = (roomId) => deps.getRoom(roomId);
  const findRoomBan: D['findRoomBan'] = (roomId, userId, ip) => deps.findRoomBan(roomId, userId, ip);
  const broadcastToUser: D['broadcastToUser'] = (userId, message) => deps.broadcastToUser(userId, message);
  const attachMediaProjection: D['attachMediaProjection'] = (context, message) =>
    deps.attachMediaProjection(context, message);
  const disconnectModeratedPeer: D['disconnectModeratedPeer'] = (room, peer, type, options) =>
    deps.disconnectModeratedPeer(room, peer, type, options);
  const liveKitGatePrincipalForPeer: D['liveKitGatePrincipalForPeer'] = (roomId, peer) =>
    deps.liveKitGatePrincipalForPeer(roomId, peer);
  const getLiveKitConfig: D['getLiveKitConfig'] = () => deps.getLiveKitConfig();
  const roomMembershipPresenceSnapshot: D['roomMembershipPresenceSnapshot'] = (roomId) =>
    deps.roomMembershipPresenceSnapshot(roomId);
  const broadcastRoomLinkPreview: D['broadcastRoomLinkPreview'] = (input) => deps.broadcastRoomLinkPreview(input);
  const broadcastDirectLinkPreview: D['broadcastDirectLinkPreview'] = (input) => deps.broadcastDirectLinkPreview(input);

  function getRoomStore() {
    if (!roomStore) {
      roomStore = createRoomStore({
        pool: requirePool(),
        roomIdleTtlMs: ROOM_IDLE_TTL_MS
      });
    }
    return roomStore;
  }

  function getUserStore() {
    if (!userStore) {
      userStore = createUserStore({ pool: requirePool(), sessionTtlMs: SESSION_TTL_MS });
    }
    return userStore;
  }

  function getGeoLocator() {
    if (!geoLocator) {
      geoLocator = createGeoLocator({ databasePath: GEOIP_DB_PATH });
    }
    return geoLocator;
  }

  function getFriendStore() {
    if (!friendStore) {
      friendStore = createFriendStore({ pool: requirePool() });
    }
    return friendStore;
  }

  function getMessageService() {
    if (!messageService) {
      messageService = createMessageService({
        directMessages: createDirectMessageRepository({ store: getFriendStore() }),
        roomMessages: createRoomMessageRepository({ store: getRoomStore() }),
        visibility: createMessageVisibilityService()
      });
    }
    return messageService;
  }

  function getHistoryServices() {
    if (!historyServices) {
      const cursorCodec = createCursorCodec({
        keys: resolveCursorHmacKeys({ context: 'history', fallbackGateSecret: LIVEKIT_GATE_SECRET })
      });
      const visibilityPolicy = createMessageVisibilityService();
      historyServices = {
        cursorCodec,
        dm: createDmHistoryService({
          cursorCodec,
          repository: createDmHistoryRepository({ pool: requirePool() }),
          projectMessage: async ({ message, peerId, userId }) => {
            const projected = await attachMediaProjection('dm', message);
            if (!projected.replyTo?.messageId) return projected;
            const replies = createReplyRepository({ client: getPool() });
            return {
              ...projected,
              replyPreview: await replies.getDirectPreview({
                userId,
                peerId,
                messageId: projected.replyTo.messageId
              })
            };
          },
          visibilityPolicy
        }),
        room: createRoomHistoryService({
          cursorCodec,
          repository: createRoomHistoryRepository({ pool: requirePool() }),
          projectMessage: async ({ message, roomId }) => {
            const projected = await attachMediaProjection('room', message);
            if (!projected.replyTo?.messageId) return projected;
            const replies = createReplyRepository({ client: getPool() });
            return {
              ...projected,
              replyPreview: await replies.getRoomPreview({
                roomId,
                messageId: projected.replyTo.messageId
              })
            };
          },
          visibilityPolicy
        }),
        read: createMessageReadService({
          authorizeRoomRead: ({ roomId, userId }) => getRoomStore().canUserReadRoomChat(roomId, userId),
          cursorCodec,
          repository: createMessageReadRepository({ pool: requirePool() })
        })
      };
    }
    return historyServices;
  }

  /** The process's one PostgreSQL pool, or null while none is installed (tests on fakes). */
  function getPool(): pg.Pool | null {
    return pool;
  }

  // Apps built on fakes still construct the services they do not fake; those
  // only fail once they actually reach for the database.
  function requirePool(): pg.Pool {
    return pool ?? MISSING_POOL;
  }

  function getAccountDeletionRepository() {
    if (accountDeletionRepository) return accountDeletionRepository;
    const pool = getPool();
    if (!pool) return null;
    accountDeletionRepository = createAccountDeletionRepository({ pool });
    return accountDeletionRepository;
  }

  function getReactionServices() {
    if (reactionServices) return reactionServices;
    const pool = getPool();
    if (!pool) return null;
    const realtime = createReactionRealtimeAdapter({
      broadcastRoom: async (roomId, event) => {
        const room = await getRoom(roomId);
        if (!room) return false;
        deps.roomRuntime()?.broadcastRoomDetail(roomId, event);
        return true;
      },
      broadcastAccount: broadcastToUser,
      resolveDirectRecipients: ({ actorUserId, conversation }) => [actorUserId, conversation!.id] as string[]
    });
    const service = createReactionService({
      repository: createReactionRepository({ client: pool }),
      cursorCodec: getHistoryServices().cursorCodec,
      requireVisible: async ({ conversation, messageId, viewer, operation }) => {
        if (conversation.type === 'room') {
          const message = await getMessageService().room.getMessage(conversation.id, messageId);
          if (!message) return false;
          if (operation === 'read' && !viewer?.id) return Boolean(await getRoom(conversation.id));
          if (!viewer?.id) return false;
          return operation === 'read'
            ? getRoomStore().canUserReadRoomChat(conversation.id, viewer.id)
            : getRoomStore().canUserReactInRoom(conversation.id, viewer.id);
        }
        if (!viewer?.id) return false;
        return Boolean(await getMessageService().direct.getMessage(viewer.id, conversation.id, messageId));
      },
      writesEnabled: () => release250FeatureEnabled('reactions'),
      publish: realtime.publish
    });
    reactionServices = { realtime, service };
    return reactionServices;
  }

  function getPinServices() {
    if (pinServices) return pinServices;
    const pool = getPool();
    if (!pool) return null;
    const service = createPinService({
      repository: createPinRepository({ client: pool }),
      // Everyone watching the room detail stream needs the new pin list: the
      // pinned bar is shared state, not a per-viewer projection.
      publish: async ({ roomId, action, messageId, pins, count }) => {
        const room = await getRoom(roomId);
        if (!room) return false;
        deps.roomRuntime()?.broadcastRoomDetail(roomId, {
          type: 'room.pins',
          payload: { roomId, action, messageId, pins, count }
        });
        return true;
      }
    });
    pinServices = { service };
    return pinServices;
  }

  function getMessageDeliveryServices() {
    if (messageDeliveryServices) return messageDeliveryServices;
    const pool = getPool();
    if (!pool) return null;
    messageDeliveryServices = {
      idempotency: createMessageIdempotencyRepository(),
      outbox: createMessageOutboxRepository({ pool })
    };
    return messageDeliveryServices;
  }

  function getNotificationServices() {
    if (notificationServices) return notificationServices;
    const pool = getPool();
    if (!pool) return null;
    const inbox = createInboxRepository({ pool });
    const mentions = createMentionRepository({ pool });
    const eligibility = createMentionEligibilityService({ activeBanService: getActiveBanService()!, pool });
    const outbox = createNotificationOutboxRepository({ pool });
    const service = createNotificationService({
      pool,
      inbox,
      mentions,
      eligibility,
      outbox,
      cursorCodec: getHistoryServices().cursorCodec,
      notificationStore: getNotificationStore()
    });
    notificationServices = { eligibility, inbox, mentions, outbox, service };
    return notificationServices;
  }

  function getModerationServices() {
    if (moderationServices) return moderationServices;
    const pool = getPool();
    if (!pool) return null;
    const repository = createModerationRepository({ cursorCodec: getHistoryServices().cursorCodec, pool });
    const service = createModerationService({
      pool,
      repository,
      maxActiveBans: MAX_ROOM_BANS,
      resolvePrincipals: async ({ roomId, userId, guestIp }) => {
        if (userId) {
          const principal = getRoomStore().normalizeGatePrincipal({ accountUserId: userId, roomId });
          return isGatePrincipal(principal) ? [principal] : [];
        }
        const room = await getRoom(roomId);
        if (!room || !guestIp) return [];
        return [...room.peers.values()]
          .filter((peer) => !peer.accountUserId && peer.ip === guestIp)
          .map((peer) => liveKitGatePrincipalForPeer(roomId, peer))
          .filter(isGatePrincipal);
      },
      revokePrincipalInTransaction: ({ client, principal, roomId, now }) =>
        getRoomStore().revokeLiveKitGatePrincipalInTransaction(client, { principal, roomId, now }),
      afterBanCommitted: async ({ roomId, userId, guestIp }) => {
        const room = await getRoom(roomId);
        if (!room) return;
        const peers = [...room.peers.values()].filter((peer) =>
          userId ? peer.accountUserId === userId : Boolean(guestIp && !peer.accountUserId && peer.ip === guestIp)
        );
        for (const peer of peers) {
          await disconnectModeratedPeer(room, peer, 'room.banned', { gateAlreadyRevoked: true });
        }
      }
    });
    const messageService = createMessageModerationService({
      pool,
      moderationService: service,
      attachmentRepository: createAttachmentRepository({ pool }),
      mediaJobRepository: createMediaJobRepository({ pool }),
      // Voice peers and preview watchers both follow the room detail stream, and
      // it is the one that removes a message from the chat.
      publishMessageDeleted: async ({ roomId, messageId }) => {
        deps
          .roomRuntime()
          ?.broadcastRoomDetail(roomId, buildServerEnvelope('room.chat.deleted', { roomId, messageId }));
      }
    });
    moderationServices = { messageService, repository, service };
    return moderationServices;
  }

  function getActiveBanService() {
    if (activeBanService) return activeBanService;
    const pool = getPool();
    if (!pool) return null;
    activeBanService = createActiveBanService({ pool });
    return activeBanService;
  }

  function getMediaServices() {
    if (mediaServices) return mediaServices;
    const pool = getPool();
    if (!pool) return null;
    const storage = createMediaStorage({ rootDir: MEDIA_STORAGE_DIR });
    const pressure = createMediaPressureService({
      storagePath: storage.root,
      minFreeBytes: readEnvInt('MEDIA_MIN_FREE_BYTES', 2 * 1024 * 1024 * 1024, 1),
      replicaConsensus: () => readinessProvider.getSnapshot()?.replicaConsensus === true,
      onSnapshot: recordMediaPressure
    });
    const attachments = createAttachmentRepository({ pool });
    const jobs = createMediaJobRepository({ pool });
    const quotaRepository = createMediaQuotaRepository({ attachmentRepository: attachments, pool });
    const quota = createMediaQuotaService({ attachmentRepository: attachments, quotaRepository });
    const service = createMediaService({
      attachmentRepository: attachments,
      jobRepository: jobs,
      pressureService: pressure,
      quotaService: quota,
      storage
    });
    const access = createMediaAccessRepository({ pool });
    const visibility = createMediaVisibilityService({
      attachmentRepository: attachments,
      storage,
      authorizeRoomAttachment: async ({ attachment, viewerId }) => {
        if (!attachment.roomMessageId) return false;
        const roomId = await access.roomOfVisibleRoomMessage({ messageId: attachment.roomMessageId, viewerId });
        if (!roomId) return false;
        return !(await getActiveBanService()!.isBanned({ roomId, userId: viewerId }));
      },
      authorizeDirectAttachment: async ({ attachment, viewerId }) => {
        if (!attachment.directMessageId) return false;
        return access.canSeeDirectMessage({ messageId: attachment.directMessageId, viewerId });
      },
      onAuthorizationInvariantFailure: recordMediaAuthorizationInvariantFailure
    });
    mediaServices = { attachments, jobs, pressure, quota, service, storage, visibility };
    return mediaServices;
  }

  function getCredentialBoundary() {
    if (credentialBoundary) return credentialBoundary;
    if (LIVEKIT_GATE_SECRET.length < 32) return null;
    const store = getRoomStore();
    if (
      typeof store.getLiveKitGatePrincipalEpoch !== 'function' ||
      typeof store.createLiveKitGateCredential !== 'function' ||
      typeof store.verifyLiveKitGateCredential !== 'function' ||
      (typeof store.revokeLiveKitGatePrincipal !== 'function' && typeof store.revokeLiveKitGatePeer !== 'function')
    ) {
      return null;
    }
    credentialBoundary = createCredentialBoundaryService({
      roomStore: store,
      secret: LIVEKIT_GATE_SECRET,
      credentialTtlMs: LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS * 1000
    });
    return credentialBoundary;
  }

  function getLiveKitCredentialProvider() {
    if (liveKitCredentialProvider) return liveKitCredentialProvider;
    const boundary = getCredentialBoundary();
    const livekit = getLiveKitConfig();
    if (!boundary || !livekit.enabled) return null;
    liveKitCredentialProvider = createLiveKitCredentialProvider({
      apiKey: livekit.apiKey,
      apiSecret: livekit.apiSecret,
      boundary,
      gateUrl: livekit.gateUrl,
      tokenTtlSeconds: LIVEKIT_TOKEN_TTL_SECONDS
    });
    return liveKitCredentialProvider;
  }

  function membershipCursorCodec() {
    return createCursorCodec({
      keys: resolveCursorHmacKeys({ context: 'membership', fallbackGateSecret: LIVEKIT_GATE_SECRET })
    });
  }

  function getMembershipServices() {
    if (membershipServices) return membershipServices;
    const membershipPool = getPool();
    if (!membershipPool) return null;
    const repository = createMembershipRepository({ pool: membershipPool });
    const service = createMembershipService({
      pool: membershipPool,
      repository,
      activeBanService: {
        // The membership service only tests the ban for truthiness.
        isBanned: ({ roomId, userId, ip }) => findRoomBan(roomId, userId, ip) as Promise<boolean>
      }
    });
    const directory = createMemberDirectoryService({
      membershipService: service,
      repository,
      cursorCodec: membershipCursorCodec(),
      getPresenceSnapshot: roomMembershipPresenceSnapshot
    });
    membershipServices = { directory, repository, service };
    return membershipServices;
  }

  function getNotificationStore() {
    if (!notificationStore) {
      notificationStore = createNotificationStore({ pool: requirePool() });
    }
    return notificationStore;
  }

  function getPushStore() {
    if (!pushStore)
      pushStore = createPushStore({ pool: requirePool(), maxSubscriptionsPerUser: MAX_PUSH_SUBSCRIPTIONS_PER_USER });
    return pushStore;
  }

  function getPushService() {
    if (!pushService) pushService = createPushService({ store: getPushStore() });
    return pushService;
  }

  function getAvatarStorage() {
    if (!avatarStorage) avatarStorage = createAvatarStorage();
    return avatarStorage;
  }

  function getLinkPreviewStorage() {
    if (!linkPreviewStorage) linkPreviewStorage = createLinkPreviewStorage();
    return linkPreviewStorage;
  }

  function getLinkPreviewService() {
    if (!LINK_PREVIEWS_ENABLED) return null;
    if (linkPreviewService) return linkPreviewService;
    const pool = getPool();
    if (!pool) return null;
    linkPreviewService = createLinkPreviewService({
      repository: createLinkPreviewRepository({ pool }),
      fetcher: createLinkPreviewFetcher(),
      storage: getLinkPreviewStorage(),
      processImage: processLinkPreviewImage,
      onRoomPreview: broadcastRoomLinkPreview,
      onDirectPreview: broadcastDirectLinkPreview
    });
    return linkPreviewService;
  }

  /**
   * Test doubles and per-app resets, exactly as createApiApp applied them:
   * derived services are rebuilt on next use. Returns whether the room store
   * changed (the in-memory roster then belongs to the old one).
   */
  // A fake has only what its test reaches; anything else fails loudly there.
  function applyOverrides(options: StoreOverrides = {}): { roomStoreChanged: boolean } {
    if (options.pool) pool = options.pool;
    const roomStoreChanged = Boolean(options.store && options.store !== roomStore);
    if (options.store) roomStore = options.store as ReturnType<typeof createRoomStore>;
    if (options.users) userStore = options.users as ReturnType<typeof createUserStore>;
    friendStoreInviteExpiryEnabled = Boolean(options.friends?.expirePendingInvites);
    if (options.friends) friendStore = options.friends as ReturnType<typeof createFriendStore>;
    messageService = null;
    historyServices = null;
    credentialBoundary = null;
    liveKitCredentialProvider =
      (options.liveKitCredentials as ReturnType<typeof createLiveKitCredentialProvider> | null | undefined) ?? null;
    membershipServices = (options.membershipServicesOverride as MembershipServices | null | undefined) ?? null;
    reactionServices = null;
    pinServices = null;
    notificationServices = null;
    moderationServices = null;
    mediaServices = null;
    activeBanService = null;
    messageDeliveryServices = null;
    if (options.notifications) notificationStore = options.notifications as ReturnType<typeof createNotificationStore>;
    pushStore = (options.pushes as ReturnType<typeof createPushStore> | null | undefined) || null;
    pushService = (options.push as ReturnType<typeof createPushService> | null | undefined) || null;
    if (options.avatars) avatarStorage = options.avatars as ReturnType<typeof createAvatarStorage>;
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
    linkPreviewStorage: ReturnType<typeof createLinkPreviewStorage> | null;
  }): void {
    ({ pushService, avatarStorage, linkPreviewStorage } = services);
    messageService = null;
  }

  /** Ends the installed pool; every store and repository shares it. */
  async function close(logger: Logger): Promise<void> {
    const installed = pool;
    pool = null;
    membershipServices = null;
    try {
      await installed?.end();
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.STORE_CLOSE_FAILED, err: error }, 'failed to close the database pool');
    }
  }

  return {
    getRoomStore,
    getUserStore,
    getGeoLocator,
    getFriendStore,
    getMessageService,
    getHistoryServices,
    getPool,
    getAccountDeletionRepository,
    getReactionServices,
    getPinServices,
    getMessageDeliveryServices,
    getNotificationServices,
    getModerationServices,
    getActiveBanService,
    getMediaServices,
    getCredentialBoundary,
    getLiveKitCredentialProvider,
    membershipCursorCodec,
    getMembershipServices,
    getNotificationStore,
    getPushStore,
    getPushService,
    getAvatarStorage,
    getLinkPreviewStorage,
    getLinkPreviewService,
    /** The friend store while pending room invitations can expire, else null. */
    invitationStore: () => (friendStoreInviteExpiryEnabled ? friendStore : null),
    applyOverrides,
    connect,
    install,
    close
  };
}
