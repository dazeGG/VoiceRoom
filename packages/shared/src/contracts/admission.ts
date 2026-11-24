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

export const NativeVoicePreference = Type.Union([Type.Literal('default'), Type.Literal('on'), Type.Literal('off')]);
export type NativeVoicePreference = Static<typeof NativeVoicePreference>;

export const VoiceReceiveEngine = Type.Union([Type.Literal('browser'), Type.Literal('native')]);
export type VoiceReceiveEngine = Static<typeof VoiceReceiveEngine>;

/** Stable renderer reasons; raw helper errors are kept in local logs. */
export const NativeVoiceFallbackReason = Type.Union([
  Type.Literal('admission_expired'),
  Type.Literal('admission_refused'),
  Type.Literal('admission_revoked'),
  Type.Literal('capability_failed'),
  Type.Literal('deafened_during_unmute'),
  Type.Literal('handoff_disconnected'),
  Type.Literal('handoff_failed'),
  Type.Literal('handoff_stalled'),
  Type.Literal('helper_fault'),
  Type.Literal('helper_stopped'),
  Type.Literal('mute_failed'),
  Type.Literal('mute_refused'),
  Type.Literal('preference_disabled'),
  Type.Literal('start_failed'),
  Type.Literal('start_refused'),
  Type.Literal('stats_stalled'),
  Type.Literal('transport_disconnected'),
  Type.Literal('track_volume_limit'),
  Type.Literal('unmute_failed'),
  Type.Literal('unmute_refused'),
  Type.Literal('unsupported_output'),
  Type.Literal('unsupported_volume'),
  Type.Literal('update_failed'),
  Type.Literal('update_refused')
]);
export type NativeVoiceFallbackReason = Static<typeof NativeVoiceFallbackReason>;

export const NativeVoiceGeneration = Type.String({ pattern: '^[0-9a-f]{32}$' });
const NativeVoiceLeaseId = Type.String({ pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' });

export const NativeVoiceAdmissionBody = Type.Object({
  version: Type.Literal(1),
  roomId: Type.String({ pattern: '^[A-Za-z0-9_-]{3,48}$' }),
  peerId: Type.String({ pattern: '^[A-Za-z0-9_-]{8,80}$' }),
  sessionToken: Type.String({ pattern: '^[A-Za-z0-9_-]{32,128}$' }),
  generation: NativeVoiceGeneration
});
export type NativeVoiceAdmissionBody = Static<typeof NativeVoiceAdmissionBody>;

export const NativeVoiceRenewalBody = Type.Object({
  ...NativeVoiceAdmissionBody.properties,
  leaseId: NativeVoiceLeaseId
});
export type NativeVoiceRenewalBody = Static<typeof NativeVoiceRenewalBody>;

export const NativeVoiceAdmission = Ok({
  version: Type.Literal(1),
  identity: Type.String(),
  generation: NativeVoiceGeneration,
  leaseId: Type.Optional(NativeVoiceLeaseId),
  expiresAt: Type.Integer(),
  room: Type.String(),
  token: Type.String(),
  ttlSeconds: Type.Integer(),
  url: Type.String()
});
export type NativeVoiceAdmission = Static<typeof NativeVoiceAdmission>;

export const NativeVoiceRenewal = Ok({
  version: Type.Literal(1),
  leaseId: NativeVoiceLeaseId,
  expiresAt: Type.Integer(),
  token: Type.String()
});
export type NativeVoiceRenewal = Static<typeof NativeVoiceRenewal>;
