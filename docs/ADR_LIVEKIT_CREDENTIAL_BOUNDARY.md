# ADR: LiveKit credential boundary for VoiceRoom 2.5.0

## Status

Accepted G05 amendment: external auth-gate selected.

## Context

VoiceRoom 2.5.0 requires strict invalidation of an already issued LiveKit token after leave, ban, or explicit revocation. Bounded replay is outside the approved scope.

The approved G04 topology uses `livekit/livekit-server:v1.13.2` with the existing app/API issuing standard LiveKit JWT credentials. Those JWTs are self-contained. Once issued, vanilla LiveKit validates the token signature and time claims at connection time; it does not call the VoiceRoom API or PostgreSQL admission state before allowing reconnect with that same token.

The G05 proof therefore froze the blocked experiment and the user selected amendment option 1: an external auth-gate while keeping self-hosted LiveKit.

## Decision

Select an external auth-gate as the only approved strict mechanism shape for VoiceRoom 2.5.0.

The original architecture can remove a participant and can stop issuing future credentials, but it cannot make the same unexpired JWT fail at the LiveKit boundary after app-side revoke, leave, or ban. The amended proof keeps the blocked baseline as G04 context and makes `G05_SELECTED_MECHANISM=external-auth-gate node scripts/lkv/run-strict-boundary-proof.mjs --json --fail-on-blocked` the green G05 command.

The amended architecture changes the boundary:

- The browser connects only to a sole public WSS gate owned by VoiceRoom.
- LiveKit `7880` is internal-only and is never a public client target.
- The browser receives a separate signed gate credential, not a reusable LiveKit boundary token.
- Gate admission is linearized through PostgreSQL room credential epochs; no positive admission cache may survive uncertainty or partition.
- Actor identity is account id or room-scoped guest UUID; IP is ban-only and is not a durable credential identity.
- Revoke, leave or ban commits the epoch change before RemoveParticipant/success is reported.
- Security beats availability: gate/controller/store uncertainty fails closed.

Established sessions are removed best-effort through the existing application disconnect and LiveKit `RemoveParticipant` path. The strict security guarantee is for every new LiveKit signaling upgrade/reconnect: the gate checks PostgreSQL credential row plus principal epoch synchronously and fails closed on uncertainty.

## Rejected Alternatives

- Short token TTL: reduces exposure but remains bounded replay.
- App-side admission checks only: blocks future mints but not direct reconnect to LiveKit with an already issued token.
- Participant removal only: disconnects the current session but does not revoke the JWT.
- Permission mutation only: changes connected participant behavior but does not invalidate the credential.
- LiveKit Cloud or hosted provider replacement: would change cost/vendor topology and is not the selected 2.5 path.
- LiveKit fork or plugin: would add high maintenance risk and is not the selected 2.5 path.
- External auth-gate without PostgreSQL linearization, epoch checks or fail-closed behavior: can still become bounded replay and is rejected.

## Consequences

- G05 green evidence must come from the amended external auth-gate proof, not from the blocked baseline experiment.
- G06 and later successors may start only after the restarted G05 branch records a green proof and review envelope.
- G47 and G48 must use the amended literal path catalogs and hostile matrix from the canonical plan/spec; they cannot infer another provider/topology or credential boundary.
- The G04 replay harness remains useful because it preserves the pinned baseline evidence that triggered the boundary decision.
