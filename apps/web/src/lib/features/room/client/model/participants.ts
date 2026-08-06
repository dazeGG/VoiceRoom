import type { Participant as LiveKitParticipant } from 'livekit-client';

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
  screenAuthoritative?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  viewedScreenPeerId?: string;
  joinedAt?: number;
  isLocal?: boolean;
}

export interface Participant {
  accountUserId: string;
  analyser: AnalyserNode | null;
  audioElements: Map<string, HTMLAudioElement>;
  avatarAccent: string;
  avatarColorKey: string;
  avatarUrl: string;
  deafened: boolean;
  id: string;
  incomingVoiceActive: boolean;
  isLocal: boolean;
  joinedAt: number;
  livekitParticipant: LiveKitParticipant | null;
  connectionQuality: string;
  meterData: Uint8Array<ArrayBuffer> | null;
  muted: boolean;
  speaking: boolean;
  statusLabel: string;
  level: number;
  name: string;
  micReceiver: RTCRtpReceiver | null;
  screen: boolean;
  screenAuthoritative: boolean | null;
  screenAudio: boolean;
  screenProfileId: string;
  screenStream: MediaStream | null;
  screenStreamId: string;
  stream: MediaStream | null;
  viewedScreenPeerId: string;
  voiceIssue: string;
}

export interface ParticipantViewRefs {
  node: HTMLElement;
  screenAction: HTMLButtonElement;
  status: HTMLParagraphElement;
}
