// The composition root's stores and services, each built on first use and
// kept for the life of the process. createApiApp swaps in test doubles
// through applyOverrides(); bootstrap installs the database-backed stores
// through install(); close() releases what holds connections.
//
// The bodies are the ones server.ts had; what they need from the realtime
// layer (rooms, broadcasts, presence) comes in through `deps`, so nothing
// here reaches back into server.ts.
//

import crypto from 'node:crypto';
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
import { createRelease250Pool } from '../lib/release-250-pool.ts';
import { recordMediaAuthorizationInvariantFailure, recordMediaPressure } from '../lib/metrics.ts';
import { createLinkPreviewRepository } from '../domains/link-previews/link-preview-repository.ts';
import { createLinkPreviewService } from '../domains/link-previews/link-preview-service.ts';
import { createAccountDeletionRepository } from '../domains/account/account-deletion-repository.ts';
import { createCredentialBoundaryService } from '../domains/admission/credential-boundary-service.ts';
import type { GateRoomStore } from '../domains/admission/credential-boundary-service.ts';
import { createLiveKitCredentialProvider } from '../domains/admission/livekit-credential-provider.ts';
import { isGatePrincipal } from '../domains/admission/gate-principal.ts';
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
};

// What the registry needs from the realtime layer, which server.ts owns.
export type ServiceRegistryDeps = {
  readinessProvider: { getSnapshot(): { replicaConsensus?: boolean } | null | undefined };
  release250FeatureEnabled: (name: string) => boolean;
  getRoom: (roomId: string) => Promise<Room | null>;
  findRoomBan: (roomId: string, userId: string | null | undefined, ip: string | null | undefined) => Promise<unknown>;
  broadcast: (room: Room, message: Record<string, unknown>) => void;
  broadcastToUser: (userId: string, message: any) => unknown;
  attachMediaProjection: (context: 'room' | 'dm', message: any) => Promise<any>;
  disconnectModeratedPeer: (room: Room, peer: any, type: string, options: { gateAlreadyRevoked?: boolean }) => Promise<unknown>;
  liveKitGatePrincipalForPeer: (roomId: string, peer: any) => unknown;
  getLiveKitConfig: () => LiveKitConfig;
  roomMembershipPresenceSnapshot: (roomId: string) => any;
  broadcastRoomLinkPreview: (input: any) => Promise<unknown>;
  broadcastDirectLinkPreview: (input: any) => Promise<unknown>;
  roomRuntime: () => { broadcastRoomDetail(roomId: string, envelope: any): void } | null | undefined;
};

type HistoryServices = {
  cursorCodec: ReturnType<typeof createCursorCodec>;
  dm: ReturnType<typeof createDmHistoryService>;
  room: ReturnType<typeof createRoomHistoryService>;
  read: ReturnType<typeof createMessageReadService>;
};
type ReactionServices = { realtime: ReturnType<typeof createReactionRealtimeAdapter>; service: ReturnType<typeof createReactionService> };
type PinServices = { service: ReturnType<typeof createPinService> };
type MessageDeliveryServices = { idempotency: ReturnType<typeof createMessageIdempotencyRepository>; outbox: ReturnType<typeof createMessageOutboxRepository> };
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
type StoreOverrides = Record<string, any>;

export function resolveCursorHmacKeys({ context, env = process.env, fallbackGateSecret = '' }: { context?: string; env?: NodeJS.ProcessEnv; fallbackGateSecret?: string } = {}): string {
  const configured = env.VOICE_ROOM_CURSOR_HMAC_KEYS
    || env.CURSOR_HMAC_KEYS
    || env.CURSOR_HMAC_KEY;
  if (configured) return configured;

  if (env.NODE_ENV === 'production') {
    throw new Error('VOICE_ROOM_CURSOR_HMAC_KEYS is required in production');
  }

  const liveKitGateSecret = typeof env.LIVEKIT_GATE_SECRET === 'string'
    ? env.LIVEKIT_GATE_SECRET.trim()
    : fallbackGateSecret;
  if (liveKitGateSecret.length >= 32) return `${liveKitGateSecret}:${context}-cursors`;

  const developmentSeed = context === 'membership' ? 'voice-room-development-membership' : 'voice-room-development-cursors';
  return crypto.createHash('sha256').update(String(env.POW_SECRET || developmentSeed)).digest('hex');
}

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
  let messageService: ReturnType<typeof createMessageService<DirectMessageRepository, RoomMessageRepository>> | null = null;
  let historyServices: HistoryServices | null = null;
  let credentialBoundary: ReturnType<typeof createCredentialBoundaryService> | null = null;
  let liveKitCredentialProvider: ReturnType<typeof createLiveKitCredentialProvider> | null = null;
  let membershipPool: ReturnType<typeof createRelease250Pool> | null = null;
  let membershipServices: MembershipServices | null = null;
  let release250Pool: ReturnType<typeof createRelease250Pool> | null = null;
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
    LINK_PREVIEWS_ENABLED
  } = config;
  const { readinessProvider } = deps;
  type D = ServiceRegistryDeps;
  const release250FeatureEnabled: D['release250FeatureEnabled'] = (name) => deps.release250FeatureEnabled(name);
  const getRoom: D['getRoom'] = (roomId) => deps.getRoom(roomId);
  const findRoomBan: D['findRoomBan'] = (roomId, userId, ip) => deps.findRoomBan(roomId, userId, ip);
  const broadcast: D['broadcast'] = (room, message) => deps.broadcast(room, message);
  const broadcastToUser: D['broadcastToUser'] = (userId, message) => deps.broadcastToUser(userId, message);
  const attachMediaProjection: D['attachMediaProjection'] = (context, message) => deps.attachMediaProjection(context, message);
  const disconnectModeratedPeer: D['disconnectModeratedPeer'] = (room, peer, type, options) => deps.disconnectModeratedPeer(room, peer, type, options);
  const liveKitGatePrincipalForPeer: D['liveKitGatePrincipalForPeer'] = (roomId, peer) => deps.liveKitGatePrincipalForPeer(roomId, peer);
  const getLiveKitConfig: D['getLiveKitConfig'] = () => deps.getLiveKitConfig();
  const roomMembershipPresenceSnapshot: D['roomMembershipPresenceSnapshot'] = (roomId) => deps.roomMembershipPresenceSnapshot(roomId);
  const broadcastRoomLinkPreview: D['broadcastRoomLinkPreview'] = (input) => deps.broadcastRoomLinkPreview(input);
  const broadcastDirectLinkPreview: D['broadcastDirectLinkPreview'] = (input) => deps.broadcastDirectLinkPreview(input);

  function getRoomStore() {
    if (!roomStore) {
      roomStore = createRoomStore({
        roomIdleTtlMs: ROOM_IDLE_TTL_MS
      });
    }
    return roomStore;
  }

  function getUserStore() {
    if (!userStore) {
      userStore = createUserStore({ sessionTtlMs: SESSION_TTL_MS });
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
      friendStore = createFriendStore({});
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
      const cursorCodec = createCursorCodec({ keys: resolveCursorHmacKeys({ context: 'history', fallbackGateSecret: LIVEKIT_GATE_SECRET }) });
      const visibilityPolicy = createMessageVisibilityService();
      historyServices = {
        cursorCodec,
        dm: createDmHistoryService({
          cursorCodec,
          repository: createDmHistoryRepository(),
          projectMessage: async ({ message, peerId, userId }) => {
            const projected = await attachMediaProjection('dm', message);
            if (!projected.replyTo?.messageId) return projected;
            const replies = createReplyRepository({ client: getRelease250Pool() });
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
          repository: createRoomHistoryRepository(),
          projectMessage: async ({ message, roomId }) => {
            const projected = await attachMediaProjection('room', message);
            if (!projected.replyTo?.messageId) return projected;
            const replies = createReplyRepository({ client: getRelease250Pool() });
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
          repository: createMessageReadRepository()
        })
      };
    }
    return historyServices;
  }

  function getRelease250Pool() {
    const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
    if (!databaseUrl) return null;
    release250Pool = release250Pool || createRelease250Pool({ databaseUrl });
    return release250Pool;
  }

  function getAccountDeletionRepository() {
    if (accountDeletionRepository) return accountDeletionRepository;
    const pool = getRelease250Pool();
    if (!pool) return null;
    accountDeletionRepository = createAccountDeletionRepository({ pool });
    return accountDeletionRepository;
  }

  function getReactionServices() {
    if (reactionServices) return reactionServices;
    const pool = getRelease250Pool();
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
    const pool = getRelease250Pool();
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
    const pool = getRelease250Pool();
    if (!pool) return null;
    messageDeliveryServices = {
      idempotency: createMessageIdempotencyRepository(),
      outbox: createMessageOutboxRepository({ pool })
    };
    return messageDeliveryServices;
  }

  function getNotificationServices() {
    if (notificationServices) return notificationServices;
    const pool = getRelease250Pool();
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
    const pool = getRelease250Pool();
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
      revokePrincipalInTransaction: ({ client, principal, roomId, now }) => (
        getRoomStore().revokeLiveKitGatePrincipalInTransaction(client, { principal, roomId, now })
      ),
      afterBanCommitted: async ({ roomId, userId, guestIp }) => {
        const room = await getRoom(roomId);
        if (!room) return;
        const peers = [...room.peers.values()].filter((peer) => userId
          ? peer.accountUserId === userId
          : Boolean(guestIp && !peer.accountUserId && peer.ip === guestIp));
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
      publishMessageDeleted: async ({ roomId, messageId, deletedAt }) => {
        const room = await getRoom(roomId);
        if (!room) return;
        broadcast(room, { type: 'chat-message-deleted', messageId, deletedAt });
      }
    });
    moderationServices = { messageService, repository, service };
    return moderationServices;
  }

  function getActiveBanService() {
    if (activeBanService) return activeBanService;
    const pool = getRelease250Pool();
    if (!pool) return null;
    activeBanService = createActiveBanService({ pool });
    return activeBanService;
  }

  function getMediaServices() {
    if (mediaServices) return mediaServices;
    const pool = getRelease250Pool();
    if (!pool) return null;
    const storage = createMediaStorage({ rootDir: process.env.MEDIA_STORAGE_DIR || '/data/media' });
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
    const visibility = createMediaVisibilityService({
      attachmentRepository: attachments,
      storage,
      authorizeRoomAttachment: async ({ attachment, viewerId }) => {
        if (!attachment.roomMessageId) return false;
        const result = await pool.query(
          `SELECT room.id AS room_id
           FROM room_messages message
           JOIN rooms room ON room.id = message.room_id AND room.deleted_at IS NULL
           JOIN room_memberships membership ON membership.room_id = room.id AND membership.user_id = $2
           WHERE message.id = $1 AND message.deleted_at IS NULL
             AND (message.expires_at IS NULL OR message.expires_at > current_timestamp)
           LIMIT 1`,
          [attachment.roomMessageId, viewerId]
        );
        if (result.rowCount !== 1) return false;
        return !await getActiveBanService()!.isBanned({ roomId: result.rows[0].room_id, userId: viewerId });
      },
      authorizeDirectAttachment: async ({ attachment, viewerId }) => {
        if (!attachment.directMessageId) return false;
        const result = await pool.query(
          `SELECT 1 FROM direct_messages
           WHERE id = $1 AND deleted_at IS NULL
             AND (sender_id = $2 OR recipient_id = $2)
           LIMIT 1`,
          [attachment.directMessageId, viewerId]
        );
        return result.rowCount === 1;
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
      typeof store.getLiveKitGatePrincipalEpoch !== 'function'
      || typeof store.createLiveKitGateCredential !== 'function'
      || typeof store.verifyLiveKitGateCredential !== 'function'
      || (
        typeof store.revokeLiveKitGatePrincipal !== 'function'
        && typeof store.revokeLiveKitGatePeer !== 'function'
      )
    ) {
      return null;
    }
    credentialBoundary = createCredentialBoundaryService({
      // An invalid epoch lookup carries `epoch: null`; the boundary reads the
      // epoch only after checking for status 'ready'.
      roomStore: store as unknown as GateRoomStore,
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
    return createCursorCodec({ keys: resolveCursorHmacKeys({ context: 'membership', fallbackGateSecret: LIVEKIT_GATE_SECRET }) });
  }

  function getMembershipServices() {
    if (membershipServices) return membershipServices;
    const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
    if (!databaseUrl) return null;
    membershipPool = membershipPool || createRelease250Pool({ databaseUrl });
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
      notificationStore = createNotificationStore({});
    }
    return notificationStore;
  }

  function getPushStore() {
    if (!pushStore) pushStore = createPushStore({ maxSubscriptionsPerUser: MAX_PUSH_SUBSCRIPTIONS_PER_USER });
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
    const pool = getRelease250Pool();
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
  function applyOverrides(options: StoreOverrides = {}): { roomStoreChanged: boolean } {
    const roomStoreChanged = Boolean(options.store && options.store !== roomStore);
    if (options.store) roomStore = options.store;
    if (options.users) userStore = options.users;
    friendStoreInviteExpiryEnabled = Boolean(options.friends?.expirePendingInvites);
    if (options.friends) friendStore = options.friends;
    messageService = null;
    historyServices = null;
    credentialBoundary = null;
    liveKitCredentialProvider = options.liveKitCredentials ?? null;
    membershipServices = options.membershipServicesOverride ?? null;
    reactionServices = null;
    pinServices = null;
    notificationServices = null;
    moderationServices = null;
    mediaServices = null;
    activeBanService = null;
    messageDeliveryServices = null;
    if (options.notifications) notificationStore = options.notifications;
    pushStore = options.pushes || null;
    pushService = options.push || null;
    if (options.avatars) avatarStorage = options.avatars;
    return { roomStoreChanged };
  }

  /** The database-backed stores bootstrap builds before the app. */
  function install(stores: StoreOverrides): void {
    ({ roomStore, userStore, friendStore, notificationStore, pushStore, pushService, avatarStorage, linkPreviewStorage } = stores);
    messageService = null;
  }

  async function close(logger: Logger): Promise<void> {
    await Promise.allSettled([
      roomStore?.close?.(),
      userStore?.close?.(),
      friendStore?.close?.(),
      notificationStore?.close?.(),
      pushStore?.close?.(),
      membershipPool?.end?.()
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') logger.error({ evt: LOG_EVENTS.STORE_CLOSE_FAILED, err: result.reason }, 'failed to close a store');
      }
    });
    membershipPool = null;
    membershipServices = null;
  }

  return {
    getRoomStore,
    getUserStore,
    getGeoLocator,
    getFriendStore,
    getMessageService,
    getHistoryServices,
    getRelease250Pool,
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
    install,
    close
  };
}

