// The API process's composition: configuration, stores and services, the
// realtime layer and the Fastify app. Everything lives inside one runtime, so
// each app a test builds starts from its own state and nothing is shared
// through module scope.

import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import { startMaintenanceTimers } from '../platform/maintenance.ts';
import { apiMaintenanceTasks } from './maintenance-tasks.ts';
import { createRealtimeHub } from './realtime-hub.ts';
import { createLiveKit } from './livekit.ts';
import { createSessionResolver } from './session.ts';
import { createServiceRegistry, type StoreOverrides } from './service-registry.ts';
import { createRequestLog } from '../platform/http/request-log.ts';
import { liveKitConnectSources, securityHeaders } from '../platform/http/security-headers.ts';
import { readApiConfig, resolveCursorHmacKeys as resolveCursorHmacKeysFor } from './config.ts';
import { registerApiRoutes } from './api-routes.ts';
import { createLogger, hashIp } from '../lib/logger.ts';
import { getClientIp } from '../lib/rate-limit.ts';
import { createRateLimits } from './rate-limits.ts';
import { createDomainServices } from './domain-services.ts';
import {
  httpTotals,
  observeMaintenance,
  recordCredentialRevokeCleanupFailure,
  renderPrometheus
} from '../lib/metrics.ts';
import { createHostProbe } from '../platform/host-probe.ts';
import { createFastifyApp } from '../platform/http/fastify-app.ts';
import { asHttpServer, type ApiServer } from '../platform/http/http-server.ts';
import type { Timer } from '../platform/types.ts';
export type { ApiServer };

import { createAdmissionService } from '../domains/admission/admission.service.ts';
import { createActivityTracker } from '../domains/account/activity.service.ts';
import { createProductSampler } from '../domains/ops/product-snapshot.service.ts';
import { createSystemSampler } from '../domains/ops/system-snapshot.service.ts';
import { staffToken } from '../domains/staff/staff.routes.ts';
import { MAX_UPLOAD_BYTES } from '../domains/media/media.service.ts';

// The process logger is pino until an app hands over its Fastify logger.
type Logger = FastifyBaseLogger;

export function createApiRuntime({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const config = readApiConfig(env);

  const services = createServiceRegistry(config, {
    roomRuntime: () => hub.runtime(),
    getRoom: (roomId) => hub.getRoom(roomId),
    findRoomBan: (roomId, userId, ip) => hub.findRoomBan(roomId, userId, ip),
    sendToUser: (userId, envelope) => hub.registry.sendToUser(userId, envelope),
    attachMediaProjectionMany: (context, messages) => hub.projection.projectMediaMany(context, messages),
    disconnectModeratedPeer: (room, peer, type, options) => domain.peerEviction.disconnect(room, peer, type, options),
    liveKitGatePrincipalForPeer: (roomId, peer) => hub.liveKitGatePrincipalForPeer(roomId, peer),
    getLiveKitConfig: () => liveKit.config(),
    roomMembershipPresenceSnapshot: (roomId) => hub.roomMembershipPresenceSnapshot(roomId),
    broadcastRoomLinkPreview: (input) => hub.linkPreviews.broadcastRoomLinkPreview(input),
    broadcastDirectLinkPreview: (input) => hub.linkPreviews.broadcastDirectLinkPreview(input)
  });

  const liveKit = createLiveKit(config, env, () => getProcessLogger());
  const hub = createRealtimeHub({
    config,
    services,
    liveKit,
    logger: () => getProcessLogger(),
    removeAvatar: (key, log) => domain.avatars.removeFile(key, log)
  });

  /** The accounts with an open realtime socket, once per socket. */
  function liveAccountIds(): string[] {
    return hub.registry.stats().accountIds;
  }

  function liveVoice() {
    return {
      guestConnections: hub.registry.stats().guests,
      voicePeers: hub.presence.peerCount(),
      voiceRooms: [...hub.presenceRooms.values()].filter((room) => room.peers.size > 0).length
    };
  }

  function liveNumbers() {
    return { ...liveVoice(), onlineAccounts: new Set(liveAccountIds()).size };
  }

  function resolveCursorHmacKeys(options: Parameters<typeof resolveCursorHmacKeysFor>[0]): string {
    return resolveCursorHmacKeysFor({ fallbackGateSecret: config.LIVEKIT_GATE_SECRET, ...options });
  }

  // Work that runs outside a request (timers, listeners, background dispatch)
  // still has to be searchable next to the requests it was triggered by, so it
  // logs through one process logger with the same base fields and redaction
  // instead of falling back to console.
  let processLogger: Logger | null = null;

  function getProcessLogger(): Logger {
    return (processLogger ||= createLogger({ name: 'api' }));
  }

  // createApp builds a fresh Fastify logger per app; background work adopts it
  // so a test harness and the real process agree on the destination.
  function setProcessLogger(logger: Logger | null): void {
    processLogger = logger || null;
  }

  const limits = createRateLimits(config);
  const admissionService = createAdmissionService({
    livekitConfig: liveKit.config,
    credentialProvider: services.getLiveKitCredentialProvider,
    credentialBoundary: services.getCredentialBoundary,
    store: services.getRoomStore,
    roomExists: async (roomId) => Boolean(await hub.getRoom(roomId)),
    findRoomBan: hub.findRoomBan,
    waitForRosterPeer: hub.presence.waitForRosterPeer,
    memberships: services.getMembershipServices,
    roomName: liveKit.roomName,
    recordRevokeFailure: recordCredentialRevokeCleanupFailure
  });
  const domain = createDomainServices({
    config,
    services,
    hub,
    liveKit,
    limits,
    logger: () => getProcessLogger(),
    admission: admissionService,
    liveNumbers,
    liveAccountIds: () => [...new Set(liveAccountIds())]
  });
  const { sessionCookies } = domain;

  // The CSP admits the LiveKit gate the browser connects to.
  function baseHeaders() {
    return securityHeaders({
      connectSources: liveKitConnectSources(config.LIVEKIT_CSP_URL),
      production: config.PRODUCTION
    });
  }

  const logHttpRequest = createRequestLog({ clientIp: (req) => getClientIp(req, config.TRUST_PROXY), hashIp });

  function getSessionToken(req: IncomingMessage) {
    return sessionCookies.read(req);
  }
  const activity = createActivityTracker({
    repository: services.getActivityRepository,
    logger: () => getProcessLogger()
  });
  const sessions = createSessionResolver({
    readToken: getSessionToken,
    users: services.getUserStore,
    geo: services.getGeoLocator,
    clientIp: (req) => getClientIp(req, config.TRUST_PROXY),
    activity
  });
  const resolveSessionUser = sessions.resolve;
  const productSampler = createProductSampler({
    live: () => ({ ...liveVoice(), accountIds: liveAccountIds() }),
    snapshots: services.getProductSnapshotRepository,
    activity
  });
  const systemSampler = createSystemSampler({
    host: createHostProbe(),
    http: httpTotals,
    live: () => ({
      ...liveVoice(),
      wsConnections: hub.registry.stats().sockets
    }),
    snapshots: services.getSystemSnapshotRepository
  });

  function startPruneTimer(server: ApiServer, logger: Logger = getProcessLogger()) {
    return startMaintenanceTimers(server, {
      keepaliveMs: config.KEEPALIVE_MS,
      intervalMs: config.ROOM_PRUNE_INTERVAL_MS,
      pruneSockets: () => hub.registry.pruneStale(),
      observe: observeMaintenance,
      logger,
      tasks: apiMaintenanceTasks({
        pruneRooms: () => hub.presence.prune(),
        sampleProduct: () => productSampler.sample(),
        sampleSystem: () => systemSampler.sample(),
        users: services.getUserStore,
        finalizeDueDeletions: () => hub.accountLifecycle.finalizeDueDeletions(),
        linkPreviews: services.getLinkPreviewService,
        rooms: services.getRoomStore,
        voiceSessions: services.getVoiceSessionRepository,
        callFeedback: services.getCallFeedbackRepository,
        staffSessions: services.getStaffRepository,
        roomBans: () => services.getActiveBanService()?.repository ?? null,
        retention: { intervalMs: config.RETENTION_PURGE_INTERVAL_MS, keepDeletedMs: config.RETENTION_KEEP_DELETED_MS }
      })
    });
  }

  function createApp({
    store = null,
    users = null,
    friends = null,
    notifications = null,
    pushes = null,
    push = null,
    avatars = null,
    liveKitCredentials = null,
    membershipServicesOverride = null,
    realtimeReconnectLeaseMs = config.REALTIME_RECONNECT_LEASE_MS,
    realtimeNow = Date.now,
    realtimeSetTimeout = globalThis.setTimeout,
    realtimeClearTimeout = globalThis.clearTimeout,
    // A test that asserts a failure was observed rather than swallowed needs
    // somewhere to observe it: Fastify's own logger is silent by default.
    logger = null
  }: {
    store?: StoreOverrides['store'];
    users?: StoreOverrides['users'];
    friends?: StoreOverrides['friends'];
    notifications?: StoreOverrides['notifications'];
    pushes?: StoreOverrides['pushes'];
    push?: StoreOverrides['push'];
    avatars?: StoreOverrides['avatars'];
    liveKitCredentials?: StoreOverrides['liveKitCredentials'];
    membershipServicesOverride?: StoreOverrides['membershipServicesOverride'];
    realtimeReconnectLeaseMs?: number;
    realtimeNow?: () => number;
    realtimeSetTimeout?(this: void, callback: () => void, ms: number): Timer;
    realtimeClearTimeout?(this: void, timer: Timer): void;
    logger?: Logger | null;
  } = {}) {
    const { roomStoreChanged } = services.applyOverrides({
      store,
      users,
      friends,
      notifications,
      pushes,
      push,
      avatars,
      liveKitCredentials,
      membershipServicesOverride
    });
    if (roomStoreChanged) hub.presence.reset();

    const app = createFastifyApp({
      bodyLimit: config.BODY_LIMIT_BYTES,
      trustProxy: config.TRUST_PROXY,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      wsMaxPayloadBytes: config.WS_MAX_PAYLOAD_BYTES,
      securityHeaders: baseHeaders,
      logRequest: logHttpRequest,
      // The admin app's cookie authenticates too, so its writes are origin-checked the same way.
      hasSessionCookie: (req) => Boolean(getSessionToken(req) || staffToken(req, config.SESSION_COOKIE_SECURE))
    });
    const appLogger = logger || app.log;
    setProcessLogger(appLogger);

    const apiContext = {
      logger: appLogger,
      clientIp: (req: http.IncomingMessage) => getClientIp(req, config.TRUST_PROXY),
      resolveSession: resolveSessionUser,
      hashIp
    };

    app.addHook('onReady', hub.deliveryRelay.start);
    app.addHook('onClose', hub.deliveryRelay.stop);

    const { roomRuntime, wsHandler } = hub.start({
      logger: appLogger,
      reconnectLeaseMs: realtimeReconnectLeaseMs,
      now: realtimeNow,
      setTimeout: realtimeSetTimeout,
      clearTimeout: realtimeClearTimeout,
      resolveSession: resolveSessionUser,
      clientIp: (req) => getClientIp(req, config.TRUST_PROXY)
    });

    const renderMetrics = () =>
      renderPrometheus({
        activeWs: hub.registry.stats().sockets,
        activeGuestWs: hub.registry.stats().guests,
        presenceRooms: hub.presenceRooms.size,
        presencePeers: hub.presence.peerCount()
      });

    registerApiRoutes(app, apiContext, {
      config,
      services,
      domain: { ...domain, admission: admissionService },
      limits,
      sessionCookies,
      sessionToken: getSessionToken,
      getRoom: hub.getRoom,
      findRoomBan: hub.findRoomBan,
      lobbyRoom: hub.roomLifecycle.lobbyRoom,
      presenceRooms: hub.presenceRooms,
      roomRuntime,
      wsHandler,
      livekitEnabled: () => liveKit.config().enabled,
      renderMetrics
    });

    return app;
  }

  function createServer(options: Parameters<typeof createApp>[0] = {}): ApiServer {
    const server = asHttpServer(createApp(options));
    server.once('close', () => hub.presence.clearOccupancyRetries());
    return server;
  }

  async function closeStores(logger: Pick<Logger, 'error'> = getProcessLogger()): Promise<void> {
    // The roster ends with the process: its open stays are written while the pool is still up.
    await hub.presence.recordOpenSessions();
    await services.close(logger);
  }

  return {
    createApp,
    createServer,
    services,
    closeStores,
    pruneRooms: hub.presence.prune,
    resolveCursorHmacKeys,
    startPruneTimer,
    sockets: () => hub.registry.allConnections(),
    config
  };
}

export type ApiRuntime = ReturnType<typeof createApiRuntime>;
