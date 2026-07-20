# LiveKit external auth-gate operations

VoiceRoom 2.5.0 uses a strict external auth-gate in front of self-hosted LiveKit.

Runtime contract:

- browsers connect to `LIVEKIT_GATE_PUBLIC_URL`, not directly to LiveKit;
- LiveKit `7880` is internal-only in production compose;
- `/api/livekit-token` returns a normal LiveKit JWT plus a separate signed `vr_gate_credential` embedded in the returned WSS URL;
- the gate strips `vr_gate_credential` before proxying the upgrade upstream;
- PostgreSQL `livekit_gate_credentials` plus `livekit_gate_principal_epochs` is the only admission authority;
- no positive admission cache is allowed;
- API, gate, PostgreSQL, migration, or config uncertainty denies new joins/reconnects.

Required production environment:

- `LIVEKIT_URL=ws://livekit:7880` or another internal LiveKit URL reachable only by backend services;
- `LIVEKIT_GATE_PUBLIC_URL=wss://<livekit-domain>/rtc`;
- `LIVEKIT_GATE_SECRET` with at least 32 characters, distinct from `LIVEKIT_API_SECRET`;
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` for LiveKit JWT minting and `RemoveParticipant`.

Revocation ordering:

1. leave/kick/ban increments the room principal epoch and revokes matching gate credential rows;
2. only after the PostgreSQL transaction succeeds does the API proceed with LiveKit participant removal and success response;
3. if the database write fails, the operation fails closed rather than pretending the boundary is strict.

Identity rules:

- authenticated users are keyed by account id;
- guests are keyed by the server-issued persistent `room_peer_identities.id` scoped to the room;
- IP is a ban signal only and is not a reusable principal, so one guest ban does not automatically ban a shared-NAT account.

Validation command:

```sh
G05_SELECTED_MECHANISM=external-auth-gate node scripts/lkv/run-strict-boundary-proof.mjs --json --fail-on-blocked
```
