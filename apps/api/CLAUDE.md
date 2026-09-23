# API guidance

- Keep HTTP handlers thin; persistence, migrations, and realtime behavior belong in their existing modules.
- The API is ES modules; applied migrations stay CommonJS as `.cjs` (byte-pinned history), new ones are ES modules. New and migrated code is strict TypeScript on Node 24 type stripping (erasable syntax only, imports with explicit extensions), with TypeBox route schemas and Kysely queries; `npm --workspace @voice-room/api run check` type-checks it. Follow the decisions and PR order in `../../docs/ARCHITECTURE.md` section 4 instead of adding routes to `server.js`.
- PostgreSQL is the durable source of truth. Preserve transaction boundaries and test rollback/failure paths.
- Add or update tests under `test/` for every behavior change.
- Verify with `npm --workspace @voice-room/api run check` and `npm --workspace @voice-room/api run test` with `TEST_DATABASE_URL` configured.
- Schema changes require forward migration, rollback coverage, and release-plan notes when compatibility is affected.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
