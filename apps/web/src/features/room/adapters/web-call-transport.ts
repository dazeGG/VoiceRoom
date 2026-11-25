import {
  LiveKitAdmission,
  LiveKitTokenBody,
  NativeVoiceAdmission,
  NativeVoiceAdmissionBody,
  NativeVoiceRenewal,
  NativeVoiceRenewalBody
} from '@voiceroom/shared/contracts/admission';
import { api, ApiError } from '@/api/client';
import { fetchCallVoiceToken } from '@/api/call-rings';
import { ERROR_TEXTS } from '@/api/error-texts';
import { fetchRoomStatus } from '@/api/rooms';
import { preloadRuntimeConfig, resolveLiveKitUrls } from '@/platform/runtime-config';
import type { CallTransport, CallRealtimeEvent, LiveKitCredentials } from '@voiceroom/call/engine/transport';

async function requestLiveKitToken(
  input: { name: string; peerId: string; roomId: string; sessionToken: string },
  callId?: string
): Promise<LiveKitCredentials> {
  // The address list comes from a second request; it goes out beside the token, not after it.
  preloadRuntimeConfig();
  const signal = AbortSignal.timeout(10_000);
  const pending = callId
    ? waitForCallVoiceJoin(callId, input.sessionToken, signal).then(() =>
        fetchCallVoiceToken(callId, input.sessionToken, signal)
      )
    : api.post('/api/livekit-token', LiveKitAdmission, input, { bodySchema: LiveKitTokenBody, signal });
  const admission = await pending.catch((error: unknown) => {
    if (signal.aborted) throw new ApiError(ERROR_TEXTS.unavailable, 0, { code: 'unavailable' });
    throw error;
  });
  return { ...admission, urls: await resolveLiveKitUrls(admission.url) };
}

import { getAppRealtime, type RealtimeEvent } from '@/api/realtime';
import { errorText } from '@/api/error-texts';
import {
  ensureAppRealtimeConnected,
  isMediaRequestError,
  joinVoiceRoom,
  leaveVoiceRoom,
  reportVoicePoll,
  requestActiveVoiceResync,
  requestMediaGrant,
  setActiveVoiceResyncFailureHandler,
  subscribeRoomVoice,
  updateVoicePeer,
  waitForCallVoiceJoin
} from '@/entities/room/room-realtime';

export function mapWebCallEvent(event: RealtimeEvent): CallRealtimeEvent | undefined {
  switch (event.type) {
    case 'error':
      if (isMediaRequestError(event.payload.id)) return;
      return {
        type: 'error',
        payload: { code: event.payload.code, message: errorText(event.payload.code) ?? undefined }
      };
    case 'pong':
    case 'room.snapshot':
    case 'room.not_found':
    case 'room.kicked':
    case 'room.banned':
    case 'room.peer.joined':
    case 'room.peer.left':
    case 'room.peer.updated':
    case 'room.companions.updated':
    case 'room.native_voice.updated':
    case 'room.voice.quality':
    case 'room.full':
    case 'server.full':
    case 'room.updated':
    case 'room.deleted':
      return event;
    default:
      return undefined;
  }
}

export const webCallTransport: CallTransport = {
  roomStatus: fetchRoomStatus,
  requestLiveKitToken,
  requestNativeVoiceAdmission: (input) =>
    api.post('/api/native-voice/admission', NativeVoiceAdmission, input, {
      bodySchema: NativeVoiceAdmissionBody,
      signal: AbortSignal.timeout(10_000)
    }),
  renewNativeVoiceLease: (input, signal) =>
    api.post('/api/native-voice/renewal', NativeVoiceRenewal, input, {
      bodySchema: NativeVoiceRenewalBody,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    }),
  failure: (error) =>
    error instanceof ApiError ? { code: error.code, status: error.status, message: error.message } : null,
  realtime: {
    ensureConnected: (...args) => ensureAppRealtimeConnected(...args),
    isConnected: () => getAppRealtime().isConnected(),
    getConnectionEpoch: () => getAppRealtime().getConnectionEpoch(),
    onStateChange: (handler) => getAppRealtime().onStateChange(handler),
    subscribeRoom: (roomId, handler) =>
      subscribeRoomVoice(roomId, (event) => {
        const mapped = mapWebCallEvent(event);
        if (mapped) handler(mapped);
      }),
    join: (...args) => joinVoiceRoom(...args),
    leave: (...args) => leaveVoiceRoom(...args),
    updatePeer: (...args) => updateVoicePeer(...args),
    reportPoll: (...args) => reportVoicePoll(...args),
    requestMediaGrant: (input) => requestMediaGrant(input),
    requestResync: (...args) => requestActiveVoiceResync(...args),
    setResyncFailureHandler: (...args) => setActiveVoiceResyncFailureHandler(...args)
  }
};
