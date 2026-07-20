# ADR: LiveKit credential boundary for VoiceRoom 2.5.0

## Status

Blocked for amendment under G05.

## Context

VoiceRoom 2.5.0 requires strict invalidation of an already issued LiveKit token after leave, ban, or explicit revocation. Bounded replay is outside the approved scope.

The approved G04 topology uses `livekit/livekit-server:v1.13.2` with the existing app/API issuing standard LiveKit JWT credentials. Those JWTs are self-contained. Once issued, vanilla LiveKit validates the token signature and time claims at connection time; it does not call the VoiceRoom API or PostgreSQL admission state before allowing reconnect with that same token.

## Decision

Do not claim a green strict credential mechanism for the existing provider/topology.

The current architecture can remove a participant and can stop issuing future credentials, but it cannot make the same unexpired JWT fail at the LiveKit boundary after app-side revoke, leave, or ban. The executable proof in `scripts/lkv/run-strict-boundary-proof.mjs` therefore records `BLOCKED_FOR_AMENDMENT` and requires the literal G05 amendment path before any successor depends on strict same-token invalidation.

## Rejected Alternatives

- Short token TTL: reduces exposure but remains bounded replay.
- App-side admission checks only: blocks future mints but not direct reconnect to LiveKit with an already issued token.
- Participant removal only: disconnects the current session but does not revoke the JWT.
- Permission mutation only: changes connected participant behavior but does not invalidate the credential.
- New provider, fork, external admission proxy, or credential callback topology: may be viable later, but changes the approved provider/topology or credential architecture and requires the G05 amendment protocol before selection.

## Consequences

- G05 cannot produce a green `approval-envelope.g05.json` or `merge-envelope.g05.json` from this experiment.
- G06 and later successors remain blocked by the G05 dependency until the amendment/re-entry protocol selects an executable strict mechanism.
- The G04 replay harness remains useful because it preserves the pinned baseline evidence that triggered the boundary decision.
