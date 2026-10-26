import crypto from 'node:crypto';
import type { RingSnapshot } from '@voice-room/shared/contracts/rings';
import type { SocialUser } from '../social/social-views.ts';
import { notificationActor } from '../social/social-views.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import type { PushPayload, PushContext } from '../notifications/notification-dispatch.ts';
import type { PushContext as TransportContext } from '../../lib/push-service.ts';
import { shouldDeliverPush } from '../../lib/push-service.ts';
import type { RingRepository, RingAction } from './ring.repository.ts';

export interface RingServiceDeps {
  repository(): RingRepository;
  findUser(userId: string): Promise<SocialUser | null>;
  findRoom(roomId: string): Promise<{ id: string; name?: string; emoji?: string } | null>;
  notifyUser(userId: string, event: AccountMessage): void;
  queueWebPush(userId: string, payload: PushPayload, context: PushContext): Promise<unknown>;
  nativePush(userId: string, payload: unknown, context: TransportContext): Promise<unknown>;
  preferences(userId: string): Promise<{
    doNotDisturb?: boolean;
    mutedPeerIds: string[];
    mutedRoomIds?: string[];
    privateNotifications?: boolean;
  }>;
  ttlMs: number;
  windowMs: number;
  maxCount: number;
}
export function createRingService(deps: RingServiceDeps) {
  async function create(
    caller: SocialUser,
    roomId: string,
    userId: string,
    clientRequestId: string = crypto.randomUUID()
  ) {
    const result = await deps.repository().create({
      callerUserId: caller.id,
      recipientUserId: userId,
      roomId,
      clientRequestId,
      ttlMs: deps.ttlMs,
      cooldownMs: deps.maxCount === 0 ? 0 : deps.windowMs,
      limit: deps.maxCount
    });
    if (result.status !== 'rung' || result.replay) return result;
    const room = result.room;
    // The transaction has committed. Failures here must not undo the stored
    // invitation; clients can replay its request ID to recover the snapshot.
    deps.notifyUser(userId, {
      type: 'ring.incoming',
      fromUser: notificationActor(caller),
      room: { id: roomId, name: room?.name || '', emoji: room?.emoji || '' },
      expiresAt: result.ring.expiresAt
    });
    if (result.message) {
      deps.notifyUser(userId, { type: 'dm-message', message: result.message });
      deps.notifyUser(caller.id, { type: 'dm-message', message: result.message });
    }
    void deps.queueWebPush(
      userId,
      {
        type: 'ring',
        title: `${caller.displayName || caller.login || 'Друг'} зовёт вас`,
        body: room?.name ? `Комната «${room.name}»` : 'Присоединиться к комнате',
        privateBody: 'Вас зовут в голосовую комнату.',
        tag: `ring:${caller.id}:${roomId}`,
        dedupeKey: `ring:${result.ring.id}:1:${userId}`,
        url: `/r/${encodeURIComponent(roomId)}`,
        expiresAt: result.ring.expiresAt
      },
      { expiresAt: result.ring.expiresAt, skipNative: true, peerUserId: caller.id, roomId }
    );
    return result;
  }
  function act(ringId: string, actorUserId: string, action: RingAction, ip = ''): Promise<RingSnapshot | null> {
    return deps.repository().act({ ringId, actorUserId, action, ip });
  }
  async function drainOnce(): Promise<boolean> {
    const repository = deps.repository();
    const job = await repository.claim();
    if (!job) return false;
    try {
      const ring = await repository.current(job);
      if (!ring) {
        await repository.finish(job);
        return true;
      }
      const nativeData: Record<string, string> = {
        ringId: ring.id,
        recipientUserId: job.recipient_user_id,
        ringRevision: String(ring.revision)
      };
      if (job.kind === 'terminal') {
        nativeData.ringState = ring.state;
        await deps.nativePush(
          job.recipient_user_id,
          { type: 'ring.state', url: '', dedupeKey: `ring:${ring.id}:${ring.revision}:${job.recipient_user_id}` },
          { expiresAt: job.deadline.getTime(), nativeData, strictFailures: true, strictPartialFailures: true }
        );
      } else {
        const preferences = await deps.preferences(job.recipient_user_id);
        if (!shouldDeliverPush(preferences, { peerUserId: ring.callerUserId, roomId: ring.roomId })) {
          await repository.finish(job);
          return true;
        }
        const current = await repository.act({ ringId: ring.id, actorUserId: ring.recipientUserId, action: 'status' });
        if (current?.state !== 'pending') {
          await repository.finish(job);
          return true;
        }
        const [caller, room] = await Promise.all([deps.findUser(ring.callerUserId), deps.findRoom(ring.roomId)]);
        nativeData.fromUserId = ring.callerUserId;
        nativeData.fromName = caller?.displayName || caller?.login || '';
        nativeData.roomId = ring.roomId;
        if (!preferences.privateNotifications) {
          nativeData.roomName = room?.name || '';
          nativeData.roomEmoji = room?.emoji || '';
        }
        // Revalidate immediately before transport: an earlier terminal job can
        // otherwise overtake this pending delivery. Native tombstones also
        // reject an in-flight initial push arriving after a terminal signal.
        if (!(await repository.current(job))) {
          await repository.finish(job);
          return true;
        }
        await deps.nativePush(
          job.recipient_user_id,
          {
            type: 'ring',
            title: `${caller?.displayName || caller?.login || 'Друг'} зовёт вас`,
            body: preferences.privateNotifications
              ? 'Вас зовут в голосовую комнату.'
              : room?.name
                ? `Комната «${room.name}»`
                : 'Присоединиться к комнате',
            url: `/r/${encodeURIComponent(ring.roomId)}`,
            expiresAt: ring.expiresAt,
            dedupeKey: `ring:${ring.id}:1:${ring.recipientUserId}`
          },
          { expiresAt: job.deadline.getTime(), nativeData, strictFailures: true, strictPartialFailures: true }
        );
      }
      await repository.finish(job);
    } catch (error) {
      await repository.finish(job, true);
      throw error;
    }
    return true;
  }
  return { create, act, drainOnce, maintenance: () => deps.repository().maintenance() };
}
export type RingService = ReturnType<typeof createRingService>;
