// The Android app's push token for the signed-in session: register it (on
// every launch and after every sign-in) and remove it (when the user turns
// pushes off). Registering is refused while the server has no RuStore project.

import { parseAndroidAppVersion } from '@voice-room/shared/client-version';
import { DEVICE_TOKEN_PATTERN, type DevicePushProvider } from '@voice-room/shared/contracts/devices';
import type { RateCheck } from '../../lib/rate-limit.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { DeviceTokenRepository } from './device-token.repository.ts';

export interface DeviceTokenServiceDeps {
  tokens(): Pick<DeviceTokenRepository, 'upsert' | 'remove'>;
  /** Whether the server can deliver to the app at all. */
  enabled(): boolean;
  /** Shared with the web push subscriptions' limit, under its own key. */
  limiter: RateCheck;
}

type RateLimited = { status: 'rate_limited'; retryAfterSeconds: number };

export function createDeviceTokenService(deps: DeviceTokenServiceDeps) {
  function rateLimited(userId: string): RateLimited | null {
    const rate = deps.limiter.check(`device-token:${userId}`);
    return rate.allowed ? null : { status: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds };
  }

  return {
    async register({
      userId,
      sessionId,
      provider,
      token,
      userAgent
    }: {
      userId: string;
      sessionId: string;
      provider: DevicePushProvider;
      token: string;
      userAgent: string;
    }): Promise<{ status: 'disabled' } | RateLimited | { status: 'registered' }> {
      if (!deps.enabled()) return { status: 'disabled' };
      // A push SDK's token is one word of printable ASCII; anything else was
      // mangled on the way, and could outgrow the index or the push.
      if (!DEVICE_TOKEN_PATTERN.test(token)) throw new DomainError('invalid_device_token', 400, 'Invalid device token');
      const limited = rateLimited(userId);
      if (limited) return limited;
      const appVersion = parseAndroidAppVersion(userAgent) || null;
      await deps.tokens().upsert({ userId, sessionId, provider, token, appVersion });
      return { status: 'registered' };
    },

    async unregister({
      userId,
      provider,
      token
    }: {
      userId: string;
      provider: DevicePushProvider;
      token: string;
    }): Promise<RateLimited | { status: 'removed' }> {
      const limited = rateLimited(userId);
      if (limited) return limited;
      await deps.tokens().remove({ userId, provider, token });
      return { status: 'removed' };
    }
  };
}

export type DeviceTokenService = ReturnType<typeof createDeviceTokenService>;
