# Coordinated media backup and restore

The release 2.5.0 media backup unit is a PostgreSQL dump plus the matching immutable uploads tree. `create-coordinated-snapshot.mjs` copies both into one directory and writes their sizes and SHA-256 hashes to `manifest.json`; a partial pair is not restorable.

Create a dump with the normal PostgreSQL tooling while media writers are quiesced or covered by the same operational cut, then run:

```sh
node scripts/backup/create-coordinated-snapshot.mjs --database /safe/input/database.dump --uploads /safe/input/uploads --output /safe/archive/snapshot-001 --namespace staging-restore-drill-001
```

Restore only into a new direct child of an isolated root. The command verifies the contract, namespace, every path, size and hash before it creates the target. It rejects symlinks, existing targets, path traversal and incomplete pairs.

```sh
node scripts/restore/restore-coordinated-snapshot.mjs --snapshot /safe/archive/snapshot-001 --allowed-root /tmp/voice-room-restore-drill --target /tmp/voice-room-restore-drill/restored --namespace staging-restore-drill-001
```

After restoring the database with `pg_restore`, reset expired media-job leases before starting workers, as recorded by `restore-report.json`. Validate attachment dimensions/state/access against the restored files, then start one worker and confirm queued cleanup/processing resumes without duplicate visible attachments.

RPO and RTO remain external staging evidence. This repository does not claim either target until a timed drill is archived in the release evidence chain.
