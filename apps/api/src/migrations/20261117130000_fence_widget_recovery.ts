import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    ALTER TABLE widget_boundary_activation
      ADD COLUMN recovery_generation bigint NOT NULL DEFAULT 0 CHECK(recovery_generation >= 0);
    CREATE TABLE widget_runtime_owners (
      role text PRIMARY KEY CHECK(role IN ('api','gate')),
      owner_id uuid,
      backend_pid integer,
      acknowledged_generation bigint,
      CHECK ((owner_id IS NULL) = (backend_pid IS NULL))
    );
    INSERT INTO widget_runtime_owners(role) VALUES ('api'),('gate');
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM widget_boundary_activation WHERE widget_boundary_required) THEN
        RAISE EXCEPTION 'activated widget boundary cannot remove recovery fencing';
      END IF;
    END $$;
    DROP TABLE widget_runtime_owners;
    ALTER TABLE widget_boundary_activation DROP COLUMN recovery_generation;
  `);
}
