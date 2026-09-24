// Server-side actions on the SFU: removing a participant (kick, ban, leave)
// and the microphone server mute.

import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import type { LiveKitConfig } from './livekit-config.ts';

interface ParticipantPermissionLike {
  canPublishSources?: number[];
  [key: string]: unknown;
}

interface LiveKitAdminClient {
  removeParticipant(room: string, identity: string): Promise<unknown>;
  getParticipant(room: string, identity: string): Promise<{ permission?: ParticipantPermissionLike; tracks?: { source?: number; muted?: boolean; sid: string }[] } | undefined>;
  updateParticipant(room: string, identity: string, metadata: undefined, permission: ParticipantPermissionLike): Promise<unknown>;
  mutePublishedTrack(room: string, identity: string, trackSid: string, muted: boolean): Promise<unknown>;
}

export type ServerMuteResult = { status: 'applied' } | { status: 'offline' } | { status: 'disconnected' } | undefined;

// A participant the SFU no longer knows is the state these calls are trying to
// reach, so it is not a failure. The LiveKit SDK reports it as a 404 whose
// message reads "participant does not exist" while only `name` and `code` say
// Not Found, so matching on the message alone never recognised it and every
// normal leave logged an error.
export function isLiveKitParticipantAlreadyGone(error: unknown): boolean {
  const value = (error ?? {}) as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  if (Number(value.status) === 404) return true;
  if (String(value.code || '').toLowerCase() === 'not_found') return true;
  const text = `${value.name || ''} ${value.message || ''}`;
  return /not.?found/i.test(text) || /does not exist/i.test(text);
}

// Server mute is enforced at the SFU, not just in the client: microphone is
// removed from the participant's allowed sources while screen sharing and data
// remain intact, and the live microphone track is muted immediately.
export function resolveServerMutePermission<T extends ParticipantPermissionLike>(currentPermission: T = {} as T, muted: boolean): T & { canPublishSources: number[] } {
  const declaredSources = Array.isArray(currentPermission.canPublishSources) ? currentPermission.canPublishSources : [];
  const currentSources = declaredSources.length > 0
    ? declaredSources
    : [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
  const canPublishSources = muted
    ? currentSources.filter((source) => source !== TrackSource.MICROPHONE)
    : [...new Set([...currentSources, TrackSource.MICROPHONE])];
  return { ...currentPermission, canPublishSources };
}

export function createLiveKitAdmin({
  config,
  roomName,
  logger,
  clientFactory = (livekit) => new RoomServiceClient(livekit.adminUrl, livekit.apiKey, livekit.apiSecret) as unknown as LiveKitAdminClient
}: {
  config: () => LiveKitConfig;
  roomName: (roomId: string) => string;
  logger: () => Pick<Logger, 'error'>;
  clientFactory?: (livekit: LiveKitConfig) => LiveKitAdminClient;
}) {
  async function removeParticipant(roomId: string, peerId: string): Promise<void> {
    const livekit = config();
    if (!livekit.enabled) return;
    try {
      await clientFactory(livekit).removeParticipant(roomName(roomId), peerId);
    } catch (error) {
      if (!isLiveKitParticipantAlreadyGone(error)) {
        logger().error({ evt: LOG_EVENTS.LIVEKIT_PARTICIPANT_REMOVE_FAILED, roomId, peerId, err: error }, 'failed to remove a moderated LiveKit participant');
      }
    }
  }

  // A failed mute falls back to disconnecting the participant; the durable mute
  // row then keeps the microphone out of every freshly issued admission.
  async function setParticipantMuted(roomId: string, peerId: string, muted: boolean): Promise<ServerMuteResult> {
    const livekit = config();
    if (!livekit.enabled) return undefined;
    const service = clientFactory(livekit);
    const room = roomName(roomId);
    try {
      const participant = await service.getParticipant(room, peerId);
      // Preserve every unrelated grant. A microphone moderation action must not
      // widen subscriptions/data grants or revoke screen-share publication.
      await service.updateParticipant(room, peerId, undefined, resolveServerMutePermission(participant?.permission || {}, muted));
      if (muted) {
        // Microphone only — a moderator mute must not silence screen-share audio.
        const microphoneTracks = (participant?.tracks || []).filter((track) => track.source === TrackSource.MICROPHONE && !track.muted);
        for (const track of microphoneTracks) await service.mutePublishedTrack(room, peerId, track.sid, true);
      }
    } catch (error) {
      if (isLiveKitParticipantAlreadyGone(error)) return { status: 'offline' };
      logger().error({ evt: LOG_EVENTS.LIVEKIT_MUTE_FAILED, roomId, peerId, err: error }, 'failed to apply a LiveKit server mute');
      if (!muted) throw error;
      try {
        await service.removeParticipant(room, peerId);
        return { status: 'disconnected' };
      } catch (disconnectError) {
        throw new AggregateError([error, disconnectError], 'LiveKit server mute and disconnect both failed', { cause: error });
      }
    }
    return { status: 'applied' };
  }

  return { removeParticipant, setParticipantMuted };
}

export type LiveKitAdmin = ReturnType<typeof createLiveKitAdmin>;
