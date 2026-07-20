# Production Digest Promotion

VoiceRoom 2.5.0 does not deploy or promote to production.

The only committed promotion surface is a manual `workflow_dispatch` preflight that stays credentialless and reports `PROMOTION_DISABLED_EXTERNAL_AUTHORITY` until a future, separately authorized annotated `v2.5.0` tag and production environment policy are verified.

Forbidden before that future authority:

- ordinary push, pull request, release, tag or backmerge production deploys;
- repository or organization production secret expressions;
- SSH, host build, migration, endpoint or environment-job execution;
- OIDC token use.

The synthetic ready fixture is only a routing contract for future release operations.
