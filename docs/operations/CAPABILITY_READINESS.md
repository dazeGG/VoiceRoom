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

`GET /api/capabilities` exposes only the nine public booleans. Health metadata may
expose the manifest contract, schema and SHA-256 digest, but operator names and values
must never be serialized to clients.
