// A room participant with every field set the way a fresh one starts, for
// tests that hand participants to the room state or its components.

import type { Participant } from '@/features/room/client/core/types';

export function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    accountUserId: '',
    analyser: null,
    audioElements: new Map(),
    avatarAccent: '',
    avatarColorKey: '',
    avatarUrl: '',
    camera: false,
    cameraStream: null,
    deafened: false,
    id: 'peer',
    isLocal: false,
    joinedAt: 0,
    livekitParticipant: null,
    connectionQuality: 'unknown',
    meter: null,
    meterData: null,
    muted: false,
    speaking: false,
    voiceDetected: false,
    speakingHoldUntil: 0,
    statusLabel: '',
    name: '',
    micReceiver: null,
    screen: false,
    screenAuthoritative: null,
    screenAudio: false,
    screenProfileId: '',
    screenStream: null,
    screenStreamId: '',
    serverMuted: false,
    stream: null,
    viewedScreenPeerId: '',
    voiceIssue: '',
    ...overrides
  };
}
