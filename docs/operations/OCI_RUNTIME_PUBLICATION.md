# OCI Runtime Publication

VoiceRoom 2.5.0 separates application runtime images from release evidence archives.

Runtime packages:

- `ghcr.io/dazegg/voiceroom-api`
- `ghcr.io/dazegg/voiceroom-web`
- `ghcr.io/dazegg/voiceroom-worker`

Each package is published by immutable digest with an SBOM digest and provenance digest. Release-candidate and staging consumers must use the same `image@sha256:...` references. Deployment hosts consume the already-built digests through `VOICEROOM_API_IMAGE` and `VOICEROOM_WEB_IMAGE`; they do not build application images.

The G03 evidence archive package, artifact type, annotations, ledger and retention role are not imported by runtime publication.
