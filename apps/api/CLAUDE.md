# API guidance

- Keep HTTP handlers thin; persistence, migrations, and realtime behavior belong in their existing modules.
- New and migrated modules are strict TypeScript `.mts` (Node 24 type stripping, erasable syntax only, imports with explicit extensions); `npm --workspace @voice-room/api run check` type-checks them. Follow the decomposition order in `../../docs/ARCHITECTURE.md` instead of adding routes to `server.js`.
- PostgreSQL is the durable source of truth. Preserve transaction boundaries and test rollback/failure paths.
- Add or update tests under `test/` for every behavior change.
- Verify with `npm --workspace @voice-room/api run check` and `npm --workspace @voice-room/api run test` with `TEST_DATABASE_URL` configured.
- Schema changes require forward migration, rollback coverage, and release-plan notes when compatibility is affected.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
