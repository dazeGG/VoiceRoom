# Capability readiness

VoiceRoom reads `config/capability-dag.v1.json` as the sole capability manifest. The
manifest contract is `voice-room.capabilities/v1`, schema version `1`, and contains
exactly nine public capabilities, ten internal prerequisites, and fifteen private
operator controls.

Public capability values are false unless the desired flag, every declared binary,
schema, index, configuration, API, Web, visibility, worker and internal prerequisite,
and every public dependency are ready. Missing or unknown inputs fail closed. A
missing replica heartbeat or any replica manifest/vector disagreement makes all
public capability values false.

Runtime readiness is derived from `capability_runtime_heartbeats`, not from static
environment declarations alone. Each worker process publishes only the tokens it
actually owns; the API intersects those fresh tokens with `CAPABILITY_READY_WORKER`.
Each API replica publishes its manifest digest and public vector, and
`CAPABILITY_EXPECTED_API_REPLICA_IDS` names the exact replicas that must be fresh and
in agreement. The default is the current `CAPABILITY_API_REPLICA_ID` (or container
hostname), so a single-replica deployment still uses a real database heartbeat.
Heartbeats refresh every `CAPABILITY_HEARTBEAT_INTERVAL_MS` (default 5 seconds) and
expire after `CAPABILITY_HEARTBEAT_MAX_AGE_MS` (default 15 seconds). Startup, database
failure, a missing worker, a missing expected API replica, or a stale vector all fail
closed.

`GET /api/capabilities` exposes only the nine public booleans. Health metadata may
expose the manifest contract, schema and SHA-256 digest, but operator names and values
must never be serialized to clients.
