# Release 2.5.0 RC preflight

This preflight prepares validation only. It never creates `release/2.5.0`, changes versions, builds or publishes images, opens a pull request, merges, tags, deploys, reads production credentials, or contacts production.

An RC evidence envelope must bind a verified G93 artifact and exact audited `develop` SHA, recorded owner authority for the release-only merge-commit exception, `release/2.5.0` base and version, exactly one active immutable candidate, and API/Web/worker/rescue/SBOM/migration/evidence digests. Any fix invalidates the previous candidate and requires the next contiguous candidate ordinal plus a complete rebuild and matrix rerun.

The required matrix includes repository gates, fresh/upgrade/rollback migrations, behavioral N-1 and rescue, Chromium twice plus Firefox/WebKit, independently captured physical desktop proof, security, privacy, observability/alerts, full activation, coordinated backup/restore, performance and at least 60 minutes of staging. Every artifact and review must bind the active candidate SHA. The validator stops at `READY_FOR_RELEASE_PR`; opening or merging that PR is a separate authorized action.

Current blockers are external: G03 archive publication/linkage/sentinel, G42/G50/G71/G90 immutable 60-minute checkpoints, G91 performance evidence, G92 activation evidence, one valid external G01 terminal selection summarized by G93, release merge-method authority, and the final physical/staging/RC matrices.
