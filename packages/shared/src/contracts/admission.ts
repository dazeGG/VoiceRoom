// Media admission: the LiveKit credentials a peer already in a room's roster
// gets to join its voice. Refusal codes drive the client's retry decisions.

import { Type, type Static } from 'typebox';
import { Ok } from './http.ts';

export const LiveKitTokenBody = Type.Object({
  roomId: Type.Optional(Type.String()),
  peerId: Type.Optional(Type.String()),
  sessionToken: Type.Optional(Type.String()),
  name: Type.Optional(Type.String())
});

export const LiveKitAdmission = Ok({
  gateCredentialId: Type.String(),
  /** The LiveKit room name, which is not the VoiceRoom room id. */
  room: Type.String(),
  token: Type.String(),
  ttlSeconds: Type.Number(),
  /** The LiveKit gate URL, carrying the gate credential. */
  url: Type.String()
});
export type LiveKitAdmission = Static<typeof LiveKitAdmission>;
