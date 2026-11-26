import type {
  LiveKitAdmission,
  NativeVoiceAdmission,
  NativeVoiceAdmissionBody,
  NativeVoiceRenewal,
  NativeVoiceRenewalBody
} from '@voiceroom/shared/contracts/admission';
import type { ErrorCode } from '@voiceroom/shared/contracts/errors';
import type { ClientCommands, MediaGrant, ServerEvent } from '@voiceroom/shared/contracts/realtime';
import type { PeerSession, RoomLifecycleSummary } from './core/types';

export type LiveKitCredentials = LiveKitAdmission & { urls: string[] };

export interface CallTransportFailure {
  code: ErrorCode | '';
  status: number;
  message: string;
}

export type CallRealtimeEvent =
  | Extract<
      ServerEvent,
      {
        type:
          | 'pong'
          | 'room.snapshot'
          | 'room.not_found'
          | 'room.kicked'
          | 'room.banned'
          | 'room.peer.joined'
          | 'room.peer.left'
          | 'room.peer.updated'
          | 'room.companions.updated'
          | 'room.native_voice.updated'
          | 'room.voice.quality'
          | 'room.full'
          | 'server.full'
          | 'room.updated'
          | 'room.deleted';
      }
    >
  | { type: 'error'; payload: { code: ErrorCode | ''; message: string | undefined } };

type Member = PeerSession & { roomId: string };

export interface CallTransport {
  roomStatus(roomId: string): Promise<Pick<RoomLifecycleSummary, 'name' | 'avatarUrl' | 'isStatic'> | null>;
  requestLiveKitToken(input: Member & { name: string }): Promise<LiveKitCredentials>;
  requestNativeVoiceAdmission?: (input: NativeVoiceAdmissionBody) => Promise<NativeVoiceAdmission>;
  renewNativeVoiceLease?: (input: NativeVoiceRenewalBody, signal: AbortSignal) => Promise<NativeVoiceRenewal>;
  failure(error: unknown): CallTransportFailure | null;
  realtime: {
    ensureConnected(): void;
    isConnected(): boolean;
    getConnectionEpoch(): number;
    onStateChange(listener: (connected: boolean, epoch: number) => void): () => void;
    subscribeRoom(roomId: string, handler: (event: CallRealtimeEvent) => void): () => void;
    join(input: Member & { name: string }): void;
    leave(input: ClientCommands['room.leave']): void;
    updatePeer(input: Member & { patch: Record<string, unknown> }): void;
    reportPoll(input: ClientCommands['room.voice.report']): void;
    requestMediaGrant(input: ClientCommands['room.media.request']): Promise<MediaGrant | null>;
    requestResync(recoveryEpoch: number, appEpoch: number, fresh?: true): boolean;
    setResyncFailureHandler(handler: ((input: { code: string }) => void) | null): void;
  };
}
