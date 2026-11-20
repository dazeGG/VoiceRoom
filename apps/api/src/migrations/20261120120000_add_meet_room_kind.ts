import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  // The existing trigger makes every room kind immutable and fences widget inserts.
  pgm.sql(`
    ALTER TABLE rooms
      DROP CONSTRAINT rooms_kind_check,
      DROP CONSTRAINT rooms_widget_shape_check,
      ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('main', 'widget', 'meet')),
      ADD CONSTRAINT rooms_widget_shape_check CHECK
        ((kind <> 'widget' AND NOT widget_chat_enabled) OR
         (kind = 'widget' AND NOT is_static AND owner_id IS NULL)),
      ADD CONSTRAINT rooms_meet_shape_check CHECK (kind <> 'meet' OR (NOT is_static AND owner_id IS NULL));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  // Restoring the original check refuses rollback while any Meet room remains.
  pgm.sql(`
    ALTER TABLE rooms
      DROP CONSTRAINT rooms_kind_check,
      DROP CONSTRAINT rooms_widget_shape_check,
      DROP CONSTRAINT rooms_meet_shape_check,
      ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('main', 'widget')),
      ADD CONSTRAINT rooms_widget_shape_check CHECK
        ((kind = 'main' AND NOT widget_chat_enabled) OR
         (kind = 'widget' AND NOT is_static AND owner_id IS NULL));
  `);
}
