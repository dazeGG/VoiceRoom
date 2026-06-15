import type { Participant as LiveKitParticipant } from 'livekit-client';

export interface PeerInfo {
  avatarColorKey?: string;
  id: string;
  name?: string;
  deafened?: boolean;
  muted?: boolean;
  screen?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  viewedScreenPeerId?: string;
  joinedAt?: number;
  isLocal?: boolean;
}

export interface Participant {
  analyser: AnalyserNode | null;
  audioElements: Map<string, HTMLAudioElement>;
  avatarColorKey: string;
  deafened: boolean;
  id: string;
  incomingVoiceActive: boolean;
  isLocal: boolean;
  joinedAt: number;
  livekitParticipant: LiveKitParticipant | null;
  connectionQuality: string;
  meterData: Uint8Array<ArrayBuffer> | null;
  muted: boolean;
  name: string;
  micReceiver: RTCRtpReceiver | null;
  screen: boolean;
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
  screenMeta: HTMLElement;
  status: HTMLParagraphElement;
}
