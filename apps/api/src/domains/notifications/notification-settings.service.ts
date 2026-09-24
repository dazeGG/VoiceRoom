// A signed-in account's notification settings: per-conversation mutes,
// private notification text, do-not-disturb and presence status (one
// preference record), and the browser push subscriptions.

import type { Logger } from 'pino';
import { cleanPresenceStatus } from '@voice-room/shared/validation';
import { cleanPushEndpoint } from '../../lib/push-endpoint.ts';

export interface MutationResult {
  status: string;
  preferences?: Record<string, unknown>;
}

export interface NotificationPreferenceStore {
  getPreferences(userId: string): Promise<unknown>;
  setDmMute(input: { userId: string; peerUserId: string; muted: boolean }): Promise<MutationResult>;
  setRoomMute(input: { userId: string; roomId: string; muted: boolean }): Promise<MutationResult>;
  setPrivateNotifications(input: { userId: string; privateNotifications: boolean }): Promise<MutationResult>;
  setDoNotDisturb(input: { userId: string; doNotDisturb: boolean }): Promise<MutationResult>;
  setPresenceStatus(input: { automatic: boolean; userId: string; presenceStatus: string }): Promise<MutationResult>;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface NotificationSettingsDeps {
  preferences(): NotificationPreferenceStore;
  pushes(): {
    upsert(input: { userId: string; subscription: PushSubscription; metadata: { userAgent: string } }): Promise<unknown>;
    remove(input: { userId: string; endpoint: string }): Promise<unknown>;
  };
  pushConfig(): { enabled: boolean; [key: string]: unknown };
  pushLimiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
  /** Tells the account's sockets which presence to report to friends. */
  setPresence(userId: string, presenceStatus: string): void;
  notifyUser(userId: string, event: Record<string, unknown>): void;
  broadcastProfileToFriends(user: Record<string, unknown> & { id: string }, log: Pick<Logger, 'error'> | undefined): Promise<void>;
}

type RateLimited = { status: 'rate_limited'; retryAfterSeconds: number };

export function cleanPushSubscription(value: unknown): PushSubscription | null {
  const raw = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null | undefined;
  const endpoint = cleanPushEndpoint(raw?.endpoint) || '';
  const p256dh = String(raw?.keys?.p256dh || '').trim();
  const auth = String(raw?.keys?.auth || '').trim();
  if (!endpoint || endpoint.length > 4096 || !p256dh || p256dh.length > 1024 || !auth || auth.length > 1024) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export function createNotificationSettingsService(deps: NotificationSettingsDeps) {
  function rateLimited(userId: string): RateLimited | null {
    const rate = deps.pushLimiter.check(`push-subscription:${userId}`);
    return rate.allowed ? null : { status: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds ?? 0 };
  }

  // Do-not-disturb and presence are one status: DND is presence 'dnd'. After
  // either changes, the account's devices get the new preferences and its
  // friends the new status.
  async function publishPresence(user: Record<string, unknown> & { id: string }, result: MutationResult, log?: Pick<Logger, 'error'>): Promise<MutationResult> {
    if (result.status !== 'updated') return result;
    const presenceStatus: string = cleanPresenceStatus(result.preferences?.presenceStatus) || (result.preferences?.doNotDisturb ? 'dnd' : 'online');
    const preferences = { ...result.preferences, doNotDisturb: presenceStatus === 'dnd', presenceStatus };
    deps.setPresence(user.id, presenceStatus);
    deps.notifyUser(user.id, { type: 'notification-settings-updated', preferences });
    await deps.broadcastProfileToFriends({ ...user, doNotDisturb: presenceStatus === 'dnd', presenceStatus }, log);
    return { ...result, preferences };
  }

  return {
    preferences: (userId: string) => deps.preferences().getPreferences(userId),
    setDmMute: (userId: string, peerUserId: string, muted: boolean) => deps.preferences().setDmMute({ userId, peerUserId, muted }),
    setRoomMute: (userId: string, roomId: string, muted: boolean) => deps.preferences().setRoomMute({ userId, roomId, muted }),
    setPrivateNotifications: (userId: string, privateNotifications: boolean) => deps.preferences().setPrivateNotifications({ userId, privateNotifications }),

    async setDoNotDisturb(user: Record<string, unknown> & { id: string }, doNotDisturb: boolean, log?: Pick<Logger, 'error'>) {
      return publishPresence(user, await deps.preferences().setDoNotDisturb({ userId: user.id, doNotDisturb }), log);
    },

    async setPresenceStatus(user: Record<string, unknown> & { id: string }, presenceStatus: string, automatic: boolean, log?: Pick<Logger, 'error'>) {
      return publishPresence(user, await deps.preferences().setPresenceStatus({ automatic, userId: user.id, presenceStatus }), log);
    },

    pushConfig: () => deps.pushConfig(),

    async subscribe(userId: string, rawSubscription: unknown, userAgent: string): Promise<RateLimited | { status: 'disabled' | 'invalid' | 'conflict' | 'subscribed' }> {
      if (!deps.pushConfig().enabled) return { status: 'disabled' };
      const subscription = cleanPushSubscription(rawSubscription);
      if (!subscription) return { status: 'invalid' };
      const limited = rateLimited(userId);
      if (limited) return limited;
      const stored = await deps.pushes().upsert({ userId, subscription, metadata: { userAgent: userAgent.slice(0, 512) } });
      return { status: stored ? 'subscribed' : 'conflict' };
    },

    async unsubscribe(userId: string, rawEndpoint: unknown): Promise<RateLimited | { status: 'invalid' | 'removed' }> {
      const endpoint = cleanPushEndpoint(rawEndpoint) || '';
      if (!endpoint) return { status: 'invalid' };
      const limited = rateLimited(userId);
      if (limited) return limited;
      await deps.pushes().remove({ userId, endpoint });
      return { status: 'removed' };
    }
  };
}

export type NotificationSettingsService = ReturnType<typeof createNotificationSettingsService>;
