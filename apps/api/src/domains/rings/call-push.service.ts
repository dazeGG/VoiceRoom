import type pg from 'pg';
import { callNotificationRoute, callPushTag, type CallPushPayload } from '@voiceroom/shared/notifications';
import { shouldDeliverPush, type PushContext, type PushPreferences } from '../../lib/push-service.ts';
import { createCallPushRepository } from './call-push.repository.ts';

type Send = (userId: string, payload: CallPushPayload, context: PushContext) => Promise<unknown>;

export function createCallPushService({
  pool,
  clock = Date.now,
  preferences,
  displayName,
  webPush,
  nativePush
}: {
  pool: () => pg.Pool | null;
  clock?: (() => number) | undefined;
  preferences: (userId: string) => Promise<NonNullable<PushPreferences> & { privateNotifications?: boolean }>;
  displayName: (userId: string) => Promise<string>;
  webPush: Send;
  nativePush: Send;
}) {
  const repository = () => {
    const connection = pool();
    return connection && createCallPushRepository(connection, clock);
  };

  async function drainOnce(): Promise<boolean> {
    const store = repository();
    if (!store) return false;
    const job = await store.claim();
    if (!job) return false;
    try {
      const target = await store.current(job);
      if (target) {
        const kind =
          job.kind === 'call-dismissal' ? 'call.state' : job.kind === 'call-missed' ? 'call.missed' : 'call.incoming';
        const userId = job.recipient_user_id;
        const actor = kind === 'call.state' ? '' : await displayName(target.peerId);
        const settings = kind === 'call.state' ? null : await preferences(userId);
        if (shouldDeliverPush(settings, { peerUserId: target.peerId })) {
          const current = await store.current(job);
          if (current) {
            const privatePush = Boolean(settings?.privateNotifications);
            const tag = callPushTag(job.ring_id, kind === 'call.missed' ? 'missed' : current.attempt);
            const expiresAt = job.deadline.getTime();
            const payload: CallPushPayload = {
              contractVersion: 1,
              type: kind,
              callId: job.ring_id,
              attempt: current.attempt,
              revision: job.revision,
              expiresAt,
              tag,
              dedupeKey: kind === 'call.missed' ? tag : `${tag}:${job.revision}`,
              url:
                kind === 'call.state'
                  ? '/'
                  : callNotificationRoute(job.ring_id, privatePush ? undefined : current.peerId),
              ...(current.dismissMissed ? { dismissMissed: true } : {}),
              ...(kind === 'call.state'
                ? {}
                : {
                    notificationPrivate: privatePush,
                    copy: {
                      title: { key: kind === 'call.missed' ? 'callMissedTitle' : 'callIncomingTitle' },
                      ...(privatePush
                        ? {}
                        : {
                            body: {
                              key: kind === 'call.missed' ? 'callMissedBody' : 'callIncomingBody',
                              args: { actor }
                            }
                          }),
                      privateBody: { key: 'callPrivateBody' }
                    }
                  })
            };
            const context = { expiresAt, strictFailures: true, strictPartialFailures: true };
            const errors: unknown[] = [];
            await Promise.all(
              [webPush, nativePush].map((send) =>
                send(userId, payload, context).catch((error: unknown) => {
                  errors.push(error);
                })
              )
            );
            if (errors.length > 0) throw new AggregateError(errors, 'Call push delivery failed');
          }
        }
      }
      await store.finish(job);
    } catch (error) {
      await store.finish(job, true);
      throw error;
    }
    return true;
  }
  return { drainOnce, prune: () => repository()?.prune() };
}
