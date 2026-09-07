# OCI Runtime Publication

VoiceRoom 2.5.0 separates application runtime images from release evidence archives.

Runtime packages:

- `ghcr.io/dazegg/voiceroom-api`
- `ghcr.io/dazegg/voiceroom-web`
- `ghcr.io/dazegg/voiceroom-worker`
- `ghcr.io/dazegg/voiceroom-musicbot`

Each package is published by immutable digest with an SBOM digest and provenance digest. Release-candidate and staging consumers must use the same `image@sha256:...` references. Deployment hosts consume the already-built digests through `VOICEROOM_API_IMAGE`, `VOICEROOM_WEB_IMAGE`, `VOICEROOM_WORKER_IMAGE` and `VOICEROOM_MUSICBOT_IMAGE`; they do not build application images.

The package id for the music bot is `musicbot` without a hyphen: `scripts/oci/build-publish.mjs` requires `composeVariable === VOICEROOM_${id.toUpperCase()}_IMAGE`, and `music-bot` would yield the invalid `VOICEROOM_MUSIC-BOT_IMAGE`. The compose service is still named `music-bot`.

The G03 evidence archive package, artifact type, annotations, ledger and retention role are not imported by runtime publication.
