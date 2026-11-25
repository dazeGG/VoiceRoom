import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import {
  CallActionBody,
  CallAnswer,
  CallBootstrap,
  CallDetails,
  CallStartBody,
  CallVoiceProof
} from '@voiceroom/shared/contracts/rings';
import { api } from './client';

const callPath = (callId: string) => `/api/call-rings/${encodeURIComponent(callId)}`;

export const fetchCallRings = () => api.get('/api/call-rings', CallBootstrap);
export const fetchCallRing = (callId: string) => api.get(callPath(callId), CallDetails);
export const startCallRing = (body: CallStartBody) =>
  api.post('/api/call-rings', CallAnswer, body, { bodySchema: CallStartBody });
export const actOnCallRing = (callId: string, body: CallActionBody) =>
  api.post(`${callPath(callId)}/actions`, CallAnswer, body, { bodySchema: CallActionBody });
export const fetchCallVoiceToken = (callId: string, seatToken: string, signal: AbortSignal) =>
  api.post(
    `${callPath(callId)}/livekit-token`,
    LiveKitAdmission,
    { seatToken },
    { bodySchema: CallVoiceProof, signal }
  );
