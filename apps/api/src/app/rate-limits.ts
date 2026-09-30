// The API's rate limits and the room-creation proof of work, one set per app.

import crypto from 'node:crypto';
import { createProofOfWork } from '../lib/pow.ts';
import { createFailureLimiter, createRateLimiter } from '../lib/rate-limit.ts';
import type { readApiConfig } from './config.ts';

type ApiConfig = ReturnType<typeof readApiConfig>;

export function createRateLimits(config: ApiConfig, env: NodeJS.ProcessEnv) {
  const limiter = (limit: number, windowMs: number) => createRateLimiter({ limit, windowMs });
  return {
    pow: createProofOfWork({
      secret: env.POW_SECRET || crypto.randomBytes(32),
      difficulty: config.ROOM_CREATE_POW_DIFFICULTY,
      ttlMs: config.ROOM_CREATE_POW_TTL_MS
    }),
    roomCreate: limiter(config.ROOM_CREATE_RATE_LIMIT, config.ROOM_CREATE_RATE_WINDOW_MS),
    roomChat: limiter(config.ROOM_CHAT_RATE_LIMIT, config.ROOM_CHAT_RATE_WINDOW_MS),
    ring: limiter(config.RING_RATE_LIMIT, config.RING_RATE_WINDOW_MS),
    auth: limiter(config.AUTH_RATE_LIMIT, config.AUTH_RATE_WINDOW_MS),
    loginFailures: createFailureLimiter({
      limit: config.LOGIN_FAILURE_LIMIT,
      windowMs: config.LOGIN_FAILURE_WINDOW_MS
    }),
    dm: limiter(config.DM_RATE_LIMIT, config.DM_RATE_WINDOW_MS),
    friendRequests: limiter(config.FRIEND_REQUEST_RATE_LIMIT, config.FRIEND_REQUEST_RATE_WINDOW_MS),
    avatarUploads: limiter(config.AVATAR_UPLOAD_RATE_LIMIT, config.AVATAR_UPLOAD_RATE_WINDOW_MS),
    pushSubscriptions: limiter(config.PUSH_SUBSCRIPTION_RATE_LIMIT, config.PUSH_SUBSCRIPTION_RATE_WINDOW_MS),
    clientLogs: limiter(config.CLIENT_LOG_RATE_LIMIT, config.CLIENT_LOG_RATE_WINDOW_MS)
  };
}

export type RateLimits = ReturnType<typeof createRateLimits>;
