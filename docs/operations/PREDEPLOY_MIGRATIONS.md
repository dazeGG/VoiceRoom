# Predeploy migrations

Production schema changes run only through the `migrate` service before API and
worker rollout. The runner acquires the repository advisory lock with a five-second
timeout, records `running`, executes ordered migrations in one transaction, verifies
that it still owns the fence, and records `clean`. Failure or lock loss leaves a
`dirty` guard and blocks production API startup.

Production `--no-lock`, listener auto-migration, and down migrations are forbidden.
An operator may clear a diagnosed dirty marker only with the explicit
`--clear-dirty` command, which itself requires the advisory lock.

Rollback selects the previous application image against additive schema. The API
readiness check treats an absent guard table as an N-1 schema and performs no schema
write, so the v2.4.2 application remains compatible before the first 2.5 migration.
