// Everything the API reads from its environment, in one place and read once
// at start-up. Names match the variables; the comments say why a default is
// what it is.

import { cleanLiveKitUrl } from '@voice-room/shared/validation';
import { readEnvBool, readEnvInt, readMessageDeliveryMode } from '../lib/config.js';

type Env = Record<string, string | undefined>;

export const DEFAULT_REALTIME_RECONNECT_LEASE_MS = 30000;

/** A comma-separated environment list as a set; empty when unset. */
export function readinessReadySetFromEnv(name: string, env: Env = process.env): Set<string> {
  const raw = (env[name] || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
}

export function resolveRealtimeReconnectLeaseMs(env: Env = process.env): number {
  const value = Number(env.REALTIME_RECONNECT_LEASE_MS);
  return Number.isInteger(value) && value >= 1000 && value <= 120000 ? value : DEFAULT_REALTIME_RECONNECT_LEASE_MS;
}

function readJsonObject(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readApiConfig(env: Env = process.env) {
  const int = (name: string, fallback: number, min: number): number => readEnvInt(name, fallback, min, env);
  const CAPABILITY_API_REPLICA_ID = (env.CAPABILITY_API_REPLICA_ID || env.HOSTNAME || 'api-primary').trim();
  const expectedReplicas = readinessReadySetFromEnv('CAPABILITY_EXPECTED_API_REPLICA_IDS', env);
  const messageDeliveryMode = readMessageDeliveryMode(env);

  return Object.freeze({
    API_PREFIX: '/api',
    HOST: (env.HOST || '127.0.0.1').trim(),
    PORT: int('PORT', 3000, 1),
    SOCKET_PATH: (env.SOCKET_PATH || '').trim(),
    MAX_ROOM_PEERS: int('MAX_ROOM_PEERS', 12, 1),
    MAX_ROOMS: int('MAX_ROOMS', 100, 1),
    KEEPALIVE_MS: int('SSE_KEEPALIVE_MS', 15000, 1000),
    BODY_LIMIT_BYTES: int('BODY_LIMIT_BYTES', 65536, 1024),
    TRUST_PROXY: readEnvBool('TRUST_PROXY', false, env) as boolean,
    // The LiveKit JWT only has to survive the join: LiveKit refreshes it for a
    // connected participant, so a short TTL bounds how long a leaked token is
    // useful. The gate credential is revocable server-side and keeps the long
    // TTL that signal resumes and in-place reconnects rely on.
    LIVEKIT_TOKEN_TTL_SECONDS: int('LIVEKIT_TOKEN_TTL_SECONDS', 600, 60),
    LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS: int('LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS', 21600, 60),
    LIVEKIT_ROSTER_WAIT_MS: int('LIVEKIT_ROSTER_WAIT_MS', 5000, 0),
    ROSTER_POLL_INTERVAL_MS: 50,
    LIVEKIT_GATE_PUBLIC_URL: cleanLiveKitUrl(env.LIVEKIT_GATE_PUBLIC_URL || env.LIVEKIT_URL || '') as string,
    LIVEKIT_GATE_SECRET: (env.LIVEKIT_GATE_SECRET || '').trim(),
    ROOM_IDLE_TTL_MS: int('ROOM_IDLE_TTL_MS', 900000, 1000),
    ROOM_PRUNE_INTERVAL_MS: int('ROOM_PRUNE_INTERVAL_MS', 60000, 0),
    ROOM_CHAT_RATE_LIMIT: int('ROOM_CHAT_RATE_LIMIT', 60, 0),
    ROOM_CHAT_RATE_WINDOW_MS: int('ROOM_CHAT_RATE_WINDOW_MS', 60000, 1000),
    ROOM_CREATE_RATE_LIMIT: int('ROOM_CREATE_RATE_LIMIT', 20, 0),
    ROOM_CREATE_RATE_WINDOW_MS: int('ROOM_CREATE_RATE_WINDOW_MS', 60000, 1000),
    MAX_TEMP_ROOMS_PER_IP: int('MAX_TEMP_ROOMS_PER_IP', int('MAX_EMPTY_ROOMS_PER_IP', 1, 0), 0),
    MAX_STATIC_ROOMS_PER_USER: int('MAX_STATIC_ROOMS_PER_USER', 3, 0),
    MAX_ROOM_BANS: int('MAX_ROOM_BANS', 100, 1),
    ROOM_CREATE_POW_DIFFICULTY: Math.min(int('ROOM_CREATE_POW_DIFFICULTY', 14, 0), 32),
    ROOM_CREATE_POW_TTL_MS: int('ROOM_CREATE_POW_TTL_MS', 120000, 10000),
    SESSION_TTL_MS: int('SESSION_TTL_MS', 30 * 24 * 60 * 60 * 1000, 60000),
    SESSION_COOKIE_NAME: 'vr_session',
    SESSION_COOKIE_SECURE: readEnvBool('SESSION_COOKIE_SECURE', env.NODE_ENV === 'production', env) as boolean,
    CAPABILITY_DAG_PATH: (env.CAPABILITY_DAG_PATH || 'config/capability-dag.v1.json').trim(),
    CAPABILITY_DESIRED: readJsonObject(env.CAPABILITY_DESIRED),
    CAPABILITY_API_REPLICA_ID,
    CAPABILITY_EXPECTED_API_REPLICA_IDS: expectedReplicas.size ? [...expectedReplicas] : [CAPABILITY_API_REPLICA_ID],
    CAPABILITY_HEARTBEAT_INTERVAL_MS: int('CAPABILITY_HEARTBEAT_INTERVAL_MS', 5_000, 1_000),
    CAPABILITY_HEARTBEAT_MAX_AGE_MS: int('CAPABILITY_HEARTBEAT_MAX_AGE_MS', 15_000, 3_000),
    AUTH_RATE_LIMIT: int('AUTH_RATE_LIMIT', 30, 0),
    AUTH_RATE_WINDOW_MS: int('AUTH_RATE_WINDOW_MS', 60000, 1000),
    LOGIN_FAILURE_LIMIT: int('LOGIN_FAILURE_LIMIT', 10, 0),
    LOGIN_FAILURE_WINDOW_MS: int('LOGIN_FAILURE_WINDOW_MS', 900000, 1000),
    GEOIP_DB_PATH: String(env.GEOIP_DB_PATH || '').trim(),
    // Close code for sockets whose account session was ended; clients stop
    // reconnecting and return to the sign-in screen instead.
    SESSION_REVOKED_CLOSE_CODE: 4401,
    DM_RATE_LIMIT: int('DM_RATE_LIMIT', 30, 0),
    DM_RATE_WINDOW_MS: int('DM_RATE_WINDOW_MS', 10000, 1000),
    FRIEND_REQUEST_RATE_LIMIT: int('FRIEND_REQUEST_RATE_LIMIT', 20, 0),
    FRIEND_REQUEST_RATE_WINDOW_MS: int('FRIEND_REQUEST_RATE_WINDOW_MS', 60000, 1000),
    RING_RATE_LIMIT: int('RING_RATE_LIMIT', 1, 0),
    RING_RATE_WINDOW_MS: int('RING_RATE_WINDOW_MS', 30000, 1000),
    RING_TTL_MS: int('RING_TTL_MS', 30000, 1000),
    AVATAR_UPLOAD_RATE_LIMIT: int('AVATAR_UPLOAD_RATE_LIMIT', 10, 0),
    AVATAR_UPLOAD_RATE_WINDOW_MS: int('AVATAR_UPLOAD_RATE_WINDOW_MS', 60000, 1000),
    PUSH_SUBSCRIPTION_RATE_LIMIT: int('PUSH_SUBSCRIPTION_RATE_LIMIT', 20, 0),
    PUSH_SUBSCRIPTION_RATE_WINDOW_MS: int('PUSH_SUBSCRIPTION_RATE_WINDOW_MS', 60000, 1000),
    MAX_PUSH_SUBSCRIPTIONS_PER_USER: int('MAX_PUSH_SUBSCRIPTIONS_PER_USER', 10, 1),
    // Browser log intake is a public write path into the log stream, so it
    // stays off unless an operator turns it on per environment.
    CLIENT_LOG_INTAKE_ENABLED: readEnvBool('CLIENT_LOG_INTAKE_ENABLED', false, env) as boolean,
    CLIENT_LOG_RATE_LIMIT: int('CLIENT_LOG_RATE_LIMIT', 6, 0),
    CLIENT_LOG_RATE_WINDOW_MS: int('CLIENT_LOG_RATE_WINDOW_MS', 60000, 1000),
    // One account cannot pin an unbounded number of keep-alive sockets.
    MAX_REALTIME_STREAMS_PER_USER: int('MAX_REALTIME_STREAMS_PER_USER', 8, 1),
    MAX_GUEST_STREAMS_PER_IP: int('MAX_GUEST_STREAMS_PER_IP', 8, 1),
    WS_MAX_PAYLOAD_BYTES: int('WS_MAX_PAYLOAD_BYTES', 64 * 1024, 1024),
    RETENTION_PURGE_INTERVAL_MS: int('RETENTION_PURGE_INTERVAL_MS', 60 * 60 * 1000, 0),
    RETENTION_KEEP_DELETED_MS: int('RETENTION_KEEP_DELETED_MS', 30 * 24 * 60 * 60 * 1000, 60000),
    // A link preview makes the API open a URL a user posted, so it is opt-in.
    LINK_PREVIEWS_ENABLED: readEnvBool('LINK_PREVIEWS_ENABLED', false, env) as boolean,
    MESSAGE_DIRECT_EMIT_ENABLED: messageDeliveryMode.directEmitEnabled as boolean,
    MESSAGE_DELIVERY_LISTEN_ENABLED: readEnvBool('MESSAGE_DELIVERY_LISTEN_ENABLED', true, env) as boolean,
    // Desktop downloads come from the latest GitHub release; the metadata is
    // cached so visitors never hit GitHub's per-IP rate limit.
    DESKTOP_RELEASE_REPO: (env.DESKTOP_RELEASE_REPO || 'dazeGG/VoiceRoomDesktop').trim(),
    DESKTOP_RELEASE_CACHE_MS: int('DESKTOP_RELEASE_CACHE_MS', 600000, 1000),
    DESKTOP_RELEASE_TIMEOUT_MS: int('DESKTOP_RELEASE_TIMEOUT_MS', 6000, 1000)
  });
}

export type ApiConfig = ReturnType<typeof readApiConfig>;
