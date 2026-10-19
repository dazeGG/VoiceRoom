import type { RemoteParticipant } from 'livekit-client';
import type { VoiceMeter } from '../media/meters';

export interface PeerInfo {
  accountUserId?: string;
  avatarAccent?: string | null;
  avatarColorKey?: string;
  avatarUrl?: string | null;
  id: string;
  name?: string;
  deafened?: boolean;
  muted?: boolean;
  screen?: boolean;
  serverMuted?: boolean;
  screenAuthoritative?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  viewedScreenPeerId?: string;
  joinedAt?: number;
  isLocal?: boolean;
}

/** What the speaking rings read from a voice: its waveform, sample by sample. */
export type MeterAnalyser = {
  readonly frequencyBinCount: number;
  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void;
};

export interface Participant {
  accountUserId: string;
  analyser: MeterAnalyser | null;
  audioElements: Map<string, HTMLAudioElement>;
  avatarAccent: string;
  avatarColorKey: string;
  avatarUrl: string;
  /** A camera track is published; `cameraStream` is set once it is received. */
  camera: boolean;
  cameraStream: MediaStream | null;
  deafened: boolean;
  id: string;
  isLocal: boolean;
  joinedAt: number;
  livekitParticipant: RemoteParticipant | null;
  connectionQuality: string;
  /** The speaking detector (or analyser) on this participant's voice, see media/meters. */
  meter: VoiceMeter | null;
  meterData: Uint8Array<ArrayBuffer> | null;
  muted: boolean;
  speaking: boolean;
  /** What the detector last heard, before mute, deafen and push-to-talk rules. */
  voiceDetected: boolean;
  /** Meter-loop bookkeeping: while `now` is under this, the ring stays lit. */
  speakingHoldUntil: number;
  statusLabel: string;
  name: string;
  micReceiver: RTCRtpReceiver | null;
  screen: boolean;
  screenAuthoritative: boolean | null;
  screenAudio: boolean;
  screenProfileId: string;
  screenStream: MediaStream | null;
  screenStreamId: string;
  /** Muted by the room owner; the participant cannot lift it themselves. */
  serverMuted: boolean;
  stream: MediaStream | null;
  viewedScreenPeerId: string;
  voiceIssue: string;
}

export interface ParticipantViewRefs {
  node: HTMLElement;
  screenAction: HTMLButtonElement;
  status: HTMLParagraphElement;
}
