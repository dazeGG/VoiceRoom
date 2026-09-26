# API guidance

- Layers and rules: `../../docs/ARCHITECTURE.md` section 3. Known old patterns still in the code (and what to do instead): section 4.
- Strict TypeScript on Node 24 type stripping: erasable syntax only, imports with explicit `.ts` extensions, no build step. Applied migrations stay CommonJS `.cjs` (byte-pinned history); new migrations are ES modules.
- New routes: a `register(app, ctx, deps)` module with TypeBox schemas for params, body and responses, modelled on `src/domains/rooms/rooms.routes.ts`. Wire them in `src/app/api-routes.ts`; a domain's services are wired in `domains/<d>/<d>.module.ts` or `src/app/domain-services.ts`. `server.ts` is only the process entry.
- File names say their layer after a dot: `<name>.routes|service|repository|policy|module.ts` (G10-A05 checks it).
- Data access: repositories take the pool (or a client inside the caller's transaction) from their caller; never create a pool inside a module. Write queries with Kysely (`platform/db/kysely.ts`: `kyselyOn(client)`, `db.transaction()`); no new raw `pg` SQL outside migrations and `platform/db`.
- Configuration is read only in `src/app/config.ts`; do not read `process.env` elsewhere.
- PostgreSQL is the durable source of truth. Preserve transaction boundaries and test rollback/failure paths.
- Add or update tests under `test/` for every behaviour change; see the root `CLAUDE.md` testing rules.
- Verify with `npm --workspace @voice-room/api run check` and `npm --workspace @voice-room/api run test` with `TEST_DATABASE_URL` configured.
- Schema changes require forward migration, rollback coverage, and release-plan notes when compatibility is affected.
- After a schema change, regenerate the Kysely types with `DATABASE_URL=<migrated db> npm --workspace @voice-room/api run db:types`; `test/db-schema-types.test.ts` fails while `src/platform/db/schema.ts` is stale.
- Follow `../../docs/GIT_FLOW.md` for all commits, branches, pull requests, hotfixes, and releases.
