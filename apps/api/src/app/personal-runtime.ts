import type { Logger } from 'pino';
import { createGateCredentialBoundary, createLiveKitProvider } from '../domains/admission/admission.module.ts';
import { registerAdmissionRoutes } from '../domains/admission/admission.routes.ts';
import { createAdmissionService } from '../domains/admission/admission.service.ts';
import { registerHealthRoutes } from '../domains/ops/health.routes.ts';
import { createOwnerCapability } from '../domains/rooms/meet-owner.service.ts';
import { registerMeetRoomRoutes } from '../domains/rooms/meet.routes.ts';
import { roomAllowsSurface } from '../domains/rooms/room-surface.policy.ts';
import { createRoomCreation } from '../domains/rooms/rooms.service.ts';
import { createRateLimiter } from '../lib/rate-limit.ts';
import { kyselyOn } from '../platform/db/kysely.ts';
import { createDbPool } from '../platform/db/pool.ts';
import { createFastifyApp } from '../platform/http/fastify-app.ts';
import { asHttpServer, type ApiServer } from '../platform/http/http-server.ts';
import { liveKitConnectSources, securityHeaders } from '../platform/http/security-headers.ts';
import { startMaintenanceTimers } from '../platform/maintenance.ts';
import { createCallRealtime } from './call-realtime.ts';
import { createCallRoomStore } from './call-room-store.ts';
import { registerCallWebSocket } from './call-ws.routes.ts';
import { readApiConfig, readPersonalOwnerConfig } from './config.ts';
import { createLiveKit } from './livekit.ts';
import { roomPruneTask } from './room-prune.ts';

export function createPersonalRuntime({
  env,
  databaseUrl,
  logger
}: {
  env: NodeJS.ProcessEnv;
  databaseUrl: string;
  logger: Logger;
}) {
  const config = readApiConfig(env);
  const { origin, ownerFile } = readPersonalOwnerConfig(env);
  const pool = createDbPool({ databaseUrl, logger });
  const rooms = createCallRoomStore(kyselyOn(pool), config.ROOM_IDLE_TTL_MS);
  const store = {
    ...rooms,
    pruneRooms: (now: number = Date.now()) => rooms.deleteMeetRooms(now),
    getOrCreatePeerIdentity: ({
      roomId,
      peerId,
      sessionToken,
      now
    }: Parameters<typeof rooms.getOrCreatePeerIdentity>[0]) =>
      rooms.getOrCreatePeerIdentity({ roomId, peerId, sessionToken, ...(now === undefined ? {} : { now }) })
  };
  const liveKit = createLiveKit(config, env, () => logger);
  const boundary = createGateCredentialBoundary({
    store,
    secret: config.LIVEKIT_GATE_SECRET,
    credentialTtlSeconds: config.LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS
  });
  const provider = createLiveKitProvider({
    boundary,
    livekit: liveKit.config(),
    tokenTtlSeconds: config.LIVEKIT_TOKEN_TTL_SECONDS
  });
  const getCredentialBoundary = () => boundary;
  const call = createCallRealtime({
    // With no IP lookup, the registry has one guest connection budget for the installation.
    config,
    maxGuestConnections: 2 * config.MAX_ROOMS * config.MAX_ROOM_PEERS,
    getRoomStore: () => store,
    getCredentialBoundary,
    liveKit,
    logger: () => logger
  });
  const admission = createAdmissionService({
    maxRoomPeers: config.MAX_ROOM_PEERS,
    livekitConfig: liveKit.config,
    credentialProvider: () => provider,
    credentialBoundary: getCredentialBoundary,
    store: () => store,
    roomExists: async (roomId) => Boolean(await call.getRoom(roomId)),
    roomAllowed: async (roomId, surface) => roomAllowsSurface(await call.getRoom(roomId), surface),
    findRoomBan: async () => null,
    waitForRosterPeer: call.presence.waitForRosterPeer,
    currentRosterPeer: call.presence.currentRosterPeer,
    memberships: () => null,
    roomName: liveKit.roomName,
    recordRevokeFailure: () => {}
  });

  function createServer(): ApiServer {
    const app = createFastifyApp({
      bodyLimit: config.BODY_LIMIT_BYTES,
      trustProxy: false,
      wsMaxPayloadBytes: config.WS_MAX_PAYLOAD_BYTES,
      browserOrigin: origin,
      logger,
      securityHeaders: () =>
        securityHeaders({ connectSources: liveKitConnectSources(config.LIVEKIT_CSP_URL), production: true }),
      logRequest: () => {}
    });
    call.start({
      logger,
      reconnectLeaseMs: config.REALTIME_RECONNECT_LEASE_MS,
      now: Date.now,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    registerHealthRoutes(app, {
      livekitEnabled: () => liveKit.config().enabled,
      ready: async () => {
        if (!provider || !boundary) return false;
        return boundary.assertReady().catch(() => false);
      }
    });
    registerMeetRoomRoutes(app, {
      owner: createOwnerCapability(ownerFile),
      origin,
      createRoom: createRoomCreation({
        store: () => store,
        limits: { maxRooms: config.MAX_ROOMS, maxOwnedStaticRoomsPerUser: 0, maxTempRoomsPerIp: 0 }
      }),
      getRoom: call.getRoom,
      createLimiter: createRateLimiter({
        limit: config.ROOM_CREATE_RATE_LIMIT,
        windowMs: config.ROOM_CREATE_RATE_WINDOW_MS
      }),
      maxRoomPeers: config.MAX_ROOM_PEERS
    });
    registerAdmissionRoutes(app, { resolveSession: async () => null, clientIp: () => '' }, admission, 'meet');
    registerCallWebSocket(app, 'meet', call.guestHandler('meet', { logger }));

    const server = asHttpServer(app);
    server.once('close', call.presence.clearOccupancyRetries);
    return server;
  }

  function startPruneTimer(server: ApiServer) {
    return startMaintenanceTimers(server, {
      keepaliveMs: config.KEEPALIVE_MS,
      intervalMs: config.ROOM_PRUNE_INTERVAL_MS || 60000,
      pruneSockets: () => call.registry.pruneStale(),
      tasks: [roomPruneTask(call.presence.prune)],
      observe: (_name, run) => run(),
      logger
    });
  }

  return {
    config,
    createServer,
    startPruneTimer,
    reconcileOnStartup: () => rooms.deleteMeetRooms(),
    sockets: () => call.registry.allConnections(),
    closeStores: () => pool.end()
  };
}
