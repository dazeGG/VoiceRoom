import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import {
  CallActionBody,
  CallAnswer,
  CallBootstrap,
  CallDetails,
  CallMissedSeenAnswer,
  CallMissedSeenBody,
  CallStartBody,
  CallVoiceTokenBody
} from '@voiceroom/shared/contracts/rings';
import { api } from './client';

const callPath = (callId: string) => `/api/call-rings/${encodeURIComponent(callId)}`;

export const fetchCallRings = () => api.get('/api/call-rings', CallBootstrap);
export const fetchCallRing = (callId: string) => api.get(callPath(callId), CallDetails);
export const markCallMissedSeen = (peerId: string, body: CallMissedSeenBody) =>
  api.post(`/api/call-rings/missed/${encodeURIComponent(peerId)}/seen`, CallMissedSeenAnswer, body, {
    bodySchema: CallMissedSeenBody
  });
export const startCallRing = (body: CallStartBody) =>
  api.post('/api/call-rings', CallAnswer, body, { bodySchema: CallStartBody });
export const actOnCallRing = (callId: string, body: CallActionBody) =>
  api.post(`${callPath(callId)}/actions`, CallAnswer, body, { bodySchema: CallActionBody });
export const fetchCallVoiceToken = (callId: string, seatToken: string, signal: AbortSignal) =>
  api.post(
    `${callPath(callId)}/livekit-token`,
    LiveKitAdmission,
    // Every 1:1 call is end-to-end encrypted (protocol 1); the server refuses a client that cannot say so.
    { seatToken, e2ee: 1 },
    { bodySchema: CallVoiceTokenBody, signal }
  );
