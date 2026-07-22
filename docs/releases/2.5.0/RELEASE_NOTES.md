# VoiceRoom 2.5.0

VoiceRoom 2.5.0 turns the existing voice-room experience into a unified messaging platform while preserving compatibility with 2.4.x clients.

## Highlights

- Cursor-based room and direct-message history, replies, durable delivery, unread state, and idempotent sends.
- Persistent room membership, offline rosters, leave/rejoin behavior, and strict revocation of issued voice credentials.
- Structured messages, mentions, notification inbox and policies, unread navigation, and Unicode reactions with reactor lists.
- Private image attachments with validation, quotas, processing, cleanup, reconciliation, authorized reads, and deletion revocation.
- Temporary room bans, idempotent unban, moderation controls, and expiry-aware rollback support.
- Runtime capability gates, worker readiness, immutable release evidence, and production-safe publication/deployment boundaries.
- Node.js 24.18.0 and npm 11.16.0 runtime baseline, plus patched production transitive dependencies.

## Deployment notes

- PostgreSQL migrations are additive and run before the new application processes start.
- Media remains on the single-server private filesystem; S3/object storage is not part of 2.5.0.
- Public capabilities and write/worker operators default to their configured safe state and must not be inferred from schema presence alone.
- Back up PostgreSQL and the media volume together before promotion.
- Roll back with the expiry-aware 2.5 rescue image after temporary-ban writes; do not use a literal 2.4.2 server binary in that state.

## Verification

The release candidate must pass the repository check, test, build, production dependency audit, migration, capability, strict credential, coverage, and release-entry gates before tagging.
