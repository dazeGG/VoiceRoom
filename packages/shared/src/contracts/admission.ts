// Media admission: the LiveKit credentials a peer already in a room's roster
// gets to join its voice. Refusal codes drive the client's retry decisions.

import { Type, type Static } from 'typebox';
import { Ok } from './http.ts';
import { RoomCapabilities } from './rooms.ts';

export const LiveKitTokenBody = Type.Object({
  roomId: Type.Optional(Type.String()),
  peerId: Type.Optional(Type.String()),
  sessionToken: Type.Optional(Type.String()),
  name: Type.Optional(Type.String())
});

export const LiveKitAdmission = Ok({
  capabilities: Type.Optional(RoomCapabilities),
  gateCredentialId: Type.String(),
  /** The LiveKit room name, which is not the VoiceRoom room id. */
  room: Type.String(),
  token: Type.String(),
  ttlSeconds: Type.Number(),
  /** The LiveKit gate URL, carrying the gate credential. */
  url: Type.String()
});
export type LiveKitAdmission = Static<typeof LiveKitAdmission>;

export const NativeVoiceStage = Type.Union([
  Type.Literal('off'),
  Type.Literal('internal-join'),
  Type.Literal('receive')
]);
export type NativeVoiceStage = Static<typeof NativeVoiceStage>;

export const NativeVoiceGeneration = Type.String({ pattern: '^[0-9a-f]{32}$' });

export const NativeVoiceAdmissionBody = Type.Object({
  version: Type.Literal(1),
  roomId: Type.String({ pattern: '^[A-Za-z0-9_-]{3,48}$' }),
  peerId: Type.String({ pattern: '^[A-Za-z0-9_-]{8,80}$' }),
  sessionToken: Type.String({ pattern: '^[A-Za-z0-9_-]{32,128}$' }),
  generation: NativeVoiceGeneration
});
export type NativeVoiceAdmissionBody = Static<typeof NativeVoiceAdmissionBody>;

export const NativeVoiceAdmission = Ok({
  version: Type.Literal(1),
  identity: Type.String(),
  generation: NativeVoiceGeneration,
  expiresAt: Type.Integer(),
  room: Type.String(),
  token: Type.String(),
  ttlSeconds: Type.Integer(),
  url: Type.String()
});
export type NativeVoiceAdmission = Static<typeof NativeVoiceAdmission>;
