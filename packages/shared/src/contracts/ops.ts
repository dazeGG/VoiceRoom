// Operational routes: health, the room-creation proof-of-work challenge, the
// desktop release manifest, browser log intake and the public feature flags.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const Health = Ok({
  livekit: Type.Boolean(),
  capabilityManifest: Type.Object({
    contractVersion: Nullable(Type.String()),
    schemaVersion: Nullable(Type.Number()),
    digest: Nullable(Type.String()),
    replicaConsensus: Type.String(),
    manifestRawSha256: Nullable(Type.String())
  })
});
export type Health = Static<typeof Health>;

/** Room creation needs a proof of work only while a difficulty is configured. */
export const PowChallenge = Type.Union([
  Ok({ required: Type.Literal(false) }),
  Ok({
    required: Type.Literal(true),
    algorithm: Type.Literal('sha256'),
    challenge: Type.String(),
    /** Leading zero bits the SHA-256 of `challenge:nonce` must have. */
    difficulty: Type.Number(),
    expiresAt: Type.Number()
  })
]);
export type PowChallenge = Static<typeof PowChallenge>;

export const DesktopAsset = Nullable(Type.Object({ url: Type.String(), size: Type.Number() }));
export type DesktopAsset = Static<typeof DesktopAsset>;

export const DesktopRelease = Ok({
  version: Type.String(),
  htmlUrl: Type.String(),
  assets: Type.Object({ 'mac-arm64': DesktopAsset, 'mac-x64': DesktopAsset, 'win-x64': DesktopAsset })
});
export type DesktopRelease = Static<typeof DesktopRelease>;

export const ClientLogsAccepted = Ok({
  accepted: Type.Number(),
  dropped: Type.Number(),
  limits: Type.Record(Type.String(), Type.Number())
});
export type ClientLogsAccepted = Static<typeof ClientLogsAccepted>;

/** The public feature flags; the only answer without `ok`. */
export const Capabilities = Type.Object({
  contractVersion: Type.Literal(1),
  apiVersion: Type.String(),
  features: Type.Record(Type.String(), Type.Boolean())
});
export type Capabilities = Static<typeof Capabilities>;
