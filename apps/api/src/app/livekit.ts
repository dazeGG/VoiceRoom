// The LiveKit side of the API: its configuration (read per call, so a test
// that changes LIVEKIT_* sees it) and the admin calls that remove or mute a
// participant.

import type { Logger } from 'pino';
import { createLiveKitAdmin } from '../domains/admission/livekit-admin.ts';
import { readLiveKitConfig } from '../domains/admission/livekit-config.ts';
import { getLiveKitRoomName } from '../domains/admission/livekit-token-binding.mts';
import type { readApiConfig } from './config.ts';

type ApiConfig = ReturnType<typeof readApiConfig>;

export function createLiveKit(
  config: Pick<ApiConfig, 'LIVEKIT_GATE_PUBLIC_URL' | 'LIVEKIT_GATE_SECRET'>,
  env: NodeJS.ProcessEnv,
  logger: () => Pick<Logger, 'error'>
) {
  const liveKitConfig = () =>
    readLiveKitConfig(env, { gatePublicUrl: config.LIVEKIT_GATE_PUBLIC_URL, gateSecret: config.LIVEKIT_GATE_SECRET });
  const admin = createLiveKitAdmin({ config: liveKitConfig, roomName: getLiveKitRoomName, logger });
  return {
    config: liveKitConfig,
    roomName: getLiveKitRoomName,
    removeParticipant: admin.removeParticipant,
    setParticipantMuted: admin.setParticipantMuted
  };
}

export type LiveKit = ReturnType<typeof createLiveKit>;
