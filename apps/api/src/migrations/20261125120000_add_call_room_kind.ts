import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE rooms
      DROP CONSTRAINT rooms_kind_check,
      ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('main', 'widget', 'meet', 'call')),
      ADD CONSTRAINT rooms_call_shape_check CHECK (
        kind <> 'call' OR (NOT is_static AND owner_id IS NULL AND NOT widget_chat_enabled)
      );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE rooms
      DROP CONSTRAINT rooms_kind_check,
      DROP CONSTRAINT rooms_call_shape_check,
      ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('main', 'widget', 'meet'));
  `);
}
