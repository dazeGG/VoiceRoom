# LiveKit auth-gate

VoiceRoom puts its own auth-gate (`livekit-gate`, `apps/api/src/domains/admission/livekit-auth-gate.service.ts`) in front of self-hosted LiveKit, so leaving, a kick or a ban stops a client from reconnecting with a token it already holds.

## Why a gate

A LiveKit JWT is self-contained: LiveKit checks its signature and time claims and never asks VoiceRoom whether the holder is still allowed in. Removing a participant disconnects the current session but does not revoke the JWT, and a short TTL only bounds the replay window. So every new signaling upgrade and reconnect goes through the gate, which checks PostgreSQL first.

Rejected alternatives: short TTL alone (bounded replay), app-side checks only (do not stop a direct reconnect with an issued token), participant removal or permission changes only (do not revoke the token), LiveKit Cloud or a LiveKit fork (cost, vendor and maintenance risk).

## Runtime contract

- Browsers connect to `LIVEKIT_GATE_PUBLIC_URL`, never to LiveKit directly. LiveKit `7880` is internal-only in production compose.
- `/api/livekit-token` returns a LiveKit JWT plus a separate signed `vr_gate_credential` in the returned WSS URL. It answers `409 not_in_room` to a peer the room roster does not know, so every media participant is visible and moderatable.
- The gate strips `vr_gate_credential` before proxying the upgrade to LiveKit.
- `livekit_gate_credentials` and `livekit_gate_principal_epochs` in PostgreSQL are the only admission authority. No positive admission cache is allowed.
- Uncertainty in the API, gate, PostgreSQL, migrations or config denies new joins and reconnects: security wins over availability.
- The gate also reads the JWT LiveKit will authenticate with (the `Authorization` header, else the single `access_token` query value) and refuses the upgrade unless `sub` is the credential's peer, `video.room` is the credential's room under `LIVEKIT_ROOM_PREFIX`, and `nbf` is not older than the credential. It does not verify the JWT signature; LiveKit does. Tokens LiveKit refreshes for a connected participant carry a later `nbf` and keep passing.

## Revocation

1. Leave, kick and ban increment the room principal epoch and revoke the matching gate credentials; a server mute revokes the principal's gate credentials too.
2. Only after that PostgreSQL transaction commits does the API remove the participant from LiveKit and report success.
3. If the database write fails, the operation fails instead of pretending the boundary holds.

A server mute revokes per principal, not per JWT: the muted account's next signal resume in that room is refused, and the client reconnects with a fresh admission that the durable mute row keeps microphone-free. That costs a short audible drop instead of a seamless resume.

## Identity

- Accounts are keyed by account id.
- Guests are keyed by the server-issued `room_peer_identities.id`, scoped to the room.
- IP is a ban signal only, never a principal, so banning one guest does not ban an account behind the same NAT.

## Configuration

- `LIVEKIT_INTERNAL_URL`: an internal LiveKit URL reachable only by backend services (production compose pins `ws://livekit:7880`).
- `LIVEKIT_GATE_PUBLIC_URL`: `wss://<livekit-domain>`.
- `LIVEKIT_GATE_SECRET`: at least 32 characters, distinct from `LIVEKIT_API_SECRET`.
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`: JWT minting and `RemoveParticipant`.
- `LIVEKIT_TOKEN_TTL_SECONDS` (`600`) for the JWT and `LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS` (`21600`) for the gate credential, which is revocable server-side and reused by signal resumes.

## Validation

CI runs the boundary proof on every push (job "G05 strict LiveKit gate proof"):

```sh
G05_SELECTED_MECHANISM=external-auth-gate node scripts/lkv/run-strict-boundary-proof.mts --json --fail-on-blocked
```
