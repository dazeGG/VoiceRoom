// Every HTTP and WebSocket route of the API, registered on one app with the
// shared context and the services each group needs.

import type { FastifyInstance } from 'fastify';
import type { ApiContext } from './context.ts';
import type { RateLimits } from './rate-limits.ts';
import type { createServiceRegistry } from './service-registry.ts';
import type { readApiConfig } from './config.ts';
import type { RoomRealtimeRuntime } from '../realtime/room-runtime.ts';
import type { createWsHandler } from '../realtime/ws-handler.ts';
import type { createRuntimeReadinessProvider } from '../platform/runtime-readiness.ts';
import { registerCapabilityRoutes } from '../platform/capability-routes.ts';
import { tokensMatch } from '../platform/crypto/tokens-match.ts';
import type { PresencePeer } from '../domains/rooms/room-views.ts';
import type { createSessionCookies } from '../domains/account/session-cookie.ts';
import { registerAccountRoutes } from '../domains/account/account.routes.ts';
import { registerAdmissionRoutes } from '../domains/admission/admission.routes.ts';
import { registerAvatarRoutes } from '../domains/media/avatars.routes.ts';
import { registerMediaRoutes } from '../domains/media/media.routes.ts';
import { registerMembershipRoutes } from '../domains/membership/membership.routes.ts';
import { registerDirectMessageRoutes } from '../domains/messaging/direct-messages.routes.ts';
import { registerHistoryRoutes } from '../domains/messaging/history.routes.ts';
import { registerPinRoutes } from '../domains/messaging/pins.routes.ts';
import { registerReactionRoutes } from '../domains/messaging/reactions.routes.ts';
import { registerRoomChatRoutes } from '../domains/messaging/room-chat.routes.ts';
import { registerModerationRoutes } from '../domains/moderation/moderation.routes.ts';
import { registerNotificationRoutes } from '../domains/notifications/notifications.routes.ts';
import { registerNotificationSettingsRoutes } from '../domains/notifications/notification-settings.routes.ts';
import { registerOpsRoutes } from '../domains/ops/ops.routes.ts';
import { registerPeerModerationRoutes } from '../domains/rooms/peer-moderation.routes.ts';
import { registerRoomRoutes } from '../domains/rooms/rooms.routes.ts';
import { registerFriendsRoutes } from '../domains/social/friends.routes.ts';

type RoomRouteDeps = Parameters<typeof registerRoomRoutes>[2];
type OpsRouteDeps = Parameters<typeof registerOpsRoutes>[2];

export interface ApiRouteDeps {
  config: Pick<
    ReturnType<typeof readApiConfig>,
    | 'MAX_ROOMS'
    | 'MAX_ROOM_PEERS'
    | 'ROOM_CREATE_POW_DIFFICULTY'
    | 'ROOM_CREATE_POW_TTL_MS'
    | 'CLIENT_LOG_INTAKE_ENABLED'
  >;
  services: ReturnType<typeof createServiceRegistry>;
  domain: {
    admission: Parameters<typeof registerAdmissionRoutes>[2];
    rooms: RoomRouteDeps['rooms'];
    peerModeration: Parameters<typeof registerPeerModerationRoutes>[2]['moderation'];
    roomChat: Parameters<typeof registerRoomChatRoutes>[2];
    friends: Parameters<typeof registerFriendsRoutes>[2]['friends'];
    directMessages: Parameters<typeof registerDirectMessageRoutes>[2];
    notificationSettings: Parameters<typeof registerNotificationSettingsRoutes>[2];
    avatars: Parameters<typeof registerAvatarRoutes>[2]['avatars'];
    account: Parameters<typeof registerAccountRoutes>[2]['account'];
    desktopRelease: OpsRouteDeps['desktopRelease'];
  };
  limits: RateLimits;
  sessionCookies: ReturnType<typeof createSessionCookies>;
  sessionToken: Parameters<typeof registerAccountRoutes>[2]['sessionToken'];
  getRoom: RoomRouteDeps['getRoom'];
  findRoomBan: RoomRouteDeps['findRoomBan'];
  lobbyRoom: RoomRouteDeps['lobbyRoom'];
  presenceRooms: Map<string, { peers: Map<string, PresencePeer> }>;
  roomRuntime: RoomRealtimeRuntime;
  wsHandler: ReturnType<typeof createWsHandler>;
  readiness: Pick<ReturnType<typeof createRuntimeReadinessProvider>, 'getSnapshot'>;
  featureEnabled: (name: string) => boolean;
  livekitEnabled: () => boolean;
  renderMetrics: OpsRouteDeps['renderMetrics'];
}

export function registerApiRoutes(app: FastifyInstance, ctx: ApiContext, deps: ApiRouteDeps): void {
  registerAdmissionRoutes(app, ctx, deps.domain.admission);
  registerRoomRoutes(app, ctx, {
    rooms: deps.domain.rooms,
    store: deps.services.getRoomStore,
    getRoom: deps.getRoom,
    findRoomBan: deps.findRoomBan,
    findAuthorizedPeer: (roomId, peerId, sessionToken) => {
      const peer = deps.presenceRooms.get(roomId)?.peers.get(peerId);
      return peer && tokensMatch(peer.sessionToken, sessionToken) ? peer : null;
    },
    lobbyRoom: deps.lobbyRoom,
    invalidateRecipientCache: (roomId) => deps.roomRuntime.invalidateRecipientCache(roomId),
    createLimiter: deps.limits.roomCreate,
    pow: deps.limits.pow,
    maxRooms: deps.config.MAX_ROOMS,
    maxRoomPeers: deps.config.MAX_ROOM_PEERS
  });
  registerPeerModerationRoutes(app, ctx, { rooms: deps.domain.rooms, moderation: deps.domain.peerModeration });
  registerRoomChatRoutes(app, ctx, deps.domain.roomChat);
  registerFriendsRoutes(app, ctx, { friends: deps.domain.friends, requestLimiter: deps.limits.friendRequests });
  registerDirectMessageRoutes(app, ctx, deps.domain.directMessages);
  registerNotificationSettingsRoutes(app, ctx, deps.domain.notificationSettings);
  registerAvatarRoutes(app, ctx, {
    avatars: deps.domain.avatars,
    rooms: deps.domain.rooms,
    uploadLimiter: deps.limits.avatarUploads
  });
  registerAccountRoutes(app, ctx, {
    account: deps.domain.account,
    limiter: deps.limits.auth,
    sessionCookie: deps.sessionCookies.issue,
    clearedSessionCookie: deps.sessionCookies.clear,
    sessionToken: deps.sessionToken,
    device: async (req) => ({
      userAgent: String(req.headers?.['user-agent'] || ''),
      // Only used for the local city/country lookup; the IP is not stored.
      locationLabel: await deps.services.getGeoLocator().locate(ctx.clientIp(req))
    })
  });
  registerOpsRoutes(app, ctx, {
    readiness: deps.readiness,
    livekitEnabled: deps.livekitEnabled,
    renderMetrics: deps.renderMetrics,
    pow: deps.limits.pow,
    powDifficulty: deps.config.ROOM_CREATE_POW_DIFFICULTY,
    powTtlMs: deps.config.ROOM_CREATE_POW_TTL_MS,
    clientLogs: { enabled: deps.config.CLIENT_LOG_INTAKE_ENABLED, limiter: deps.limits.clientLogs },
    desktopRelease: deps.domain.desktopRelease
  });

  registerCapabilityRoutes(app, deps.readiness);

  const memberships = deps.services.getMembershipServices();
  if (memberships) {
    registerMembershipRoutes(app, ctx, {
      directory: memberships.directory,
      memberships: memberships.service,
      enabled: () => {
        try {
          return deps.readiness.getSnapshot()?.features?.membership === true;
        } catch {
          return false;
        }
      },
      prepareLeave: ({ roomId, userId }) => deps.roomRuntime.disconnectAccountFromRoom({ roomId, userId }),
      onLeft: async ({ roomId, userId }) => {
        await deps.services.getRoomStore().removeRoomBookmarkForUser(userId, roomId);
        deps.roomRuntime.invalidateRecipientCache(roomId);
      }
    });
  }

  registerHistoryRoutes(app, ctx, {
    rooms: deps.services.getHistoryServices().room,
    directs: deps.services.getHistoryServices().dm,
    canReadRoom: (roomId, userId) => deps.services.getRoomStore().canUserReadRoomChat(roomId, userId)
  });

  const reactions = deps.services.getReactionServices();
  if (reactions) {
    registerReactionRoutes(app, ctx, { reactions: reactions.service });
  }

  const pins = deps.services.getPinServices();
  if (pins) {
    registerPinRoutes(app, ctx, {
      pins: pins.service,
      canRead: (roomId, userId) => deps.services.getRoomStore().canUserReadRoomChat(roomId, userId),
      canWrite: (roomId, userId) => deps.services.getRoomStore().canUserReactInRoom(roomId, userId)
    });
  }

  const notificationDomain = deps.services.getNotificationServices();
  if (notificationDomain) {
    registerNotificationRoutes(app, ctx, {
      notifications: notificationDomain.service,
      enabled: () => deps.featureEnabled('engagement')
    });
  }

  const moderation = deps.services.getModerationServices();
  if (moderation) {
    registerModerationRoutes(app, ctx, {
      moderation: moderation.service,
      messages: moderation.messageService,
      enabled: () => deps.featureEnabled('moderationCenter')
    });
  }

  const media = deps.services.getMediaServices();
  if (media) {
    registerMediaRoutes(app, ctx, {
      media: media.service,
      visibility: media.visibility,
      uploadsEnabled: () => deps.featureEnabled('mediaUploads'),
      readsEnabled: () => deps.featureEnabled('mediaRead')
    });
  }

  // Register after plugins finish loading so @fastify/websocket can wrap the handler.
  app.after(() => {
    app.get('/api/ws', { websocket: true }, (socket, request) => {
      void deps.wsHandler.handleConnection(socket, request.raw);
    });
  });
}
