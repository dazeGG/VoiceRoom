# Expiry-aware rescue profile

The 2.5.0 rescue profile is a read-safe API image for a fully upgraded schema. It preserves 2.4.2 response envelopes, admits only active memberships, and treats a ban as active only when it is not revoked and `expires_at` is null or in the future. Every 2.5.0 capability, new write path and background worker remains disabled.

Build the image with the `Build expiry-aware rescue image` workflow. The workflow records the digest produced by BuildKit as an artifact; this repository intentionally contains no invented GHCR digest or attestation.

Before use, verify that all migrations through `20260718141000_add_temporary_ban_indexes.js` are applied, configure `CAPABILITY_DESIRED` from `config/rescue/expiry-aware-v2.5.0.json`, and keep worker processes stopped. Exercise 2.4.2 reads, active membership admission, an active temporary ban, an expired temporary ban, and a legacy permanent ban against an isolated restored snapshot. Do not deploy if any new-write endpoint or worker becomes effective.

Promotion, registry publication, attestation and staging drill evidence are external release gates.
