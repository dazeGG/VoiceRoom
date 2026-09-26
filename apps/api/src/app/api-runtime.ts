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
import {
  readApiConfig,
  resolveCursorHmacKeys as resolveCursorHmacKeysFor,
  resolveRealtimeReconnectLeaseMs
} from './config.ts';
import { createApiReadiness } from './readiness.ts';
import { registerApiRoutes } from './api-routes.ts';
import { cleanLiveKitUrl } from '@voice-room/shared/validation';
import { createLogger, hashIp } from '../lib/logger.ts';
import { getClientIp } from '../lib/rate-limit.ts';
import { createRateLimits } from './rate-limits.ts';
import { createDomainServices } from './domain-services.ts';
import { observeMaintenance, recordCredentialRevokeCleanupFailure, renderPrometheus } from '../lib/metrics.ts';
import { createFastifyApp } from '../platform/http/fastify-app.ts';
import { asHttpServer, type ApiServer } from '../platform/http/http-server.ts';
export type { ApiServer };

import { createAdmissionService } from '../domains/admission/admission.service.ts';
import { MAX_UPLOAD_BYTES } from '../domains/media/media.service.ts';

type Logger = ReturnType<typeof createLogger>;
type Timer = ReturnType<typeof globalThis.setTimeout> | number;
type ReadinessProvider = ReturnType<typeof createApiReadiness>;
type AppReadiness = Pick<ReadinessProvider, 'getSnapshot'> & Partial<Pick<ReadinessProvider, 'start' | 'stop'>>;

export function createApiRuntime({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const config = readApiConfig(env);
  const readinessProvider = createApiReadiness(config, env, () => services.getPool());

  const services = createServiceRegistry(config, {
    readinessProvider,
    release250FeatureEnabled: (name) => release250FeatureEnabled(name),
    roomRuntime: () => hub.runtime(),
    getRoom: (roomId) => hub.getRoom(roomId),
    findRoomBan: (roomId, userId, ip) => hub.findRoomBan(roomId, userId, ip),
    sendToUser: (userId, envelope) => hub.registry()?.sendToUser(userId, envelope) ?? 0,
    attachMediaProjection: (context, message) => hub.projection.projectMedia(context, message),
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

  function resolveCursorHmacKeys(options: Parameters<typeof resolveCursorHmacKeysFor>[0]): string {
    return resolveCursorHmacKeysFor({ fallbackGateSecret: config.LIVEKIT_GATE_SECRET, ...options });
  }

  // Work that runs outside a request (timers, listeners, background dispatch)
  // still has to be searchable next to the requests it was triggered by, so it
  // logs through one process logger with the same base fields and redaction
  // instead of falling back to console.
  let processLogger: Logger | FastifyBaseLogger | null = null;

  function getProcessLogger(): Logger {
    return (processLogger ||= createLogger({ name: 'api' })) as Logger;
  }

  // createApp builds a fresh Fastify logger per app; background work adopts it
  // so a test harness and the real process agree on the destination.
  function setProcessLogger(logger: Logger | FastifyBaseLogger | null): void {
    processLogger = logger || null;
  }

  function release250FeatureEnabled(name: string): boolean {
    try {
      return readinessProvider.getSnapshot()?.features?.[name] === true;
    } catch {
      return false;
    }
  }

  const limits = createRateLimits(config, env);
  let admissionService: ReturnType<typeof createAdmissionService> | null = null;
  const domain = createDomainServices({
    config,
    env,
    services,
    hub,
    liveKit,
    limits,
    featureEnabled: release250FeatureEnabled,
    logger: () => getProcessLogger(),
    admission: () => admissionService
  });
  const { sessionCookies } = domain;

  // The CSP admits the LiveKit gate the browser connects to, read per request
  // so a changed LIVEKIT_URL in tests takes effect.
  function baseHeaders() {
    return securityHeaders({
      connectSources: liveKitConnectSources(cleanLiveKitUrl(config.LIVEKIT_GATE_PUBLIC_URL || env.LIVEKIT_URL || '')),
      production: env.NODE_ENV === 'production'
    });
  }

  const logHttpRequest = createRequestLog({ clientIp: (req) => getClientIp(req, config.TRUST_PROXY), hashIp });

  function getSessionToken(req: IncomingMessage) {
    return sessionCookies.read(req);
  }
  const sessions = createSessionResolver({
    readToken: getSessionToken,
    users: services.getUserStore,
    geo: services.getGeoLocator,
    clientIp: (req) => getClientIp(req, config.TRUST_PROXY)
  });
  const resolveSessionUser = sessions.resolve;

  function startPruneTimer(server: ApiServer, logger: Logger = getProcessLogger()) {
    return startMaintenanceTimers(server, {
      keepaliveMs: config.KEEPALIVE_MS,
      intervalMs: config.ROOM_PRUNE_INTERVAL_MS,
      pruneSockets: () => hub.registry()?.pruneStale(),
      observe: observeMaintenance,
      logger,
      tasks: apiMaintenanceTasks({
        pruneRooms: () => hub.presence.prune(),
        users: services.getUserStore,
        finalizeDueDeletions: () => hub.accountLifecycle.finalizeDueDeletions(),
        linkPreviews: services.getLinkPreviewService,
        rooms: services.getRoomStore,
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
    readinessProviderOverride = null,
    realtimeReconnectLeaseMs = resolveRealtimeReconnectLeaseMs(env),
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
    /** Readiness as the app reads it; a test may hand just the snapshot. */
    readinessProviderOverride?: AppReadiness | null;
    realtimeReconnectLeaseMs?: number;
    realtimeNow?: () => number;
    realtimeSetTimeout?(this: void, callback: () => void, ms: number): Timer;
    realtimeClearTimeout?(this: void, timer: Timer): void;
    logger?: Logger | FastifyBaseLogger | null;
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
      hasSessionCookie: (req) => Boolean(getSessionToken(req))
    });
    const appLogger = logger || app.log;
    setProcessLogger(appLogger);

    admissionService = createAdmissionService({
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
    const apiContext = {
      logger: appLogger,
      clientIp: (req: http.IncomingMessage) => getClientIp(req, config.TRUST_PROXY),
      resolveSession: resolveSessionUser,
      hashIp
    };

    const activeReadinessProvider = readinessProviderOverride || readinessProvider;
    app.addHook('onReady', async () => {
      await activeReadinessProvider.start?.();
    });
    app.addHook('onClose', async () => {
      await activeReadinessProvider.stop?.();
    });
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

    const renderMetrics = () => {
      const readiness = (() => {
        try {
          return activeReadinessProvider.getSnapshot();
        } catch {
          return null;
        }
      })();
      return renderPrometheus({
        activeWs: hub.registry()?.connections?.size || 0,
        activeGuestWs: hub.activeGuestConnections(),
        presenceRooms: hub.presenceRooms.size,
        presencePeers: hub.presence.peerCount(),
        capabilityReadiness: readiness?.features || {}
      });
    };

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
      readiness: activeReadinessProvider,
      featureEnabled: release250FeatureEnabled,
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
    sockets: () => hub.registry()?.connections?.values?.() || [],
    config
  };
}

export type ApiRuntime = ReturnType<typeof createApiRuntime>;
