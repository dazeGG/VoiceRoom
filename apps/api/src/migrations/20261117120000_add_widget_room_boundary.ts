import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    ALTER TABLE rooms
      ADD COLUMN kind text NOT NULL DEFAULT 'main',
      ADD COLUMN widget_chat_enabled boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('main', 'widget')),
      ADD CONSTRAINT rooms_widget_shape_check CHECK
        ((kind = 'main' AND NOT widget_chat_enabled) OR
         (kind = 'widget' AND NOT is_static AND owner_id IS NULL));
    CREATE TABLE widget_boundary_activation (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      widget_boundary_required boolean NOT NULL DEFAULT false,
      widget_admission_enabled boolean NOT NULL DEFAULT false,
      CHECK (NOT widget_admission_enabled OR widget_boundary_required)
    );
    INSERT INTO widget_boundary_activation DEFAULT VALUES;
    CREATE FUNCTION preserve_widget_boundary_floor() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' OR (OLD.widget_boundary_required AND NOT NEW.widget_boundary_required) THEN
        RAISE EXCEPTION 'widget boundary activation floor cannot be cleared';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER widget_boundary_floor_immutable BEFORE UPDATE OR DELETE ON widget_boundary_activation
      FOR EACH ROW EXECUTE FUNCTION preserve_widget_boundary_floor();
    CREATE FUNCTION enforce_room_widget_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.widget_chat_enabled IS DISTINCT FROM OLD.widget_chat_enabled THEN
          RAISE EXCEPTION 'room kind and widget chat capability are immutable';
        END IF;
      ELSIF NEW.kind = 'widget' THEN
        PERFORM singleton FROM widget_boundary_activation WHERE singleton AND widget_boundary_required AND widget_admission_enabled FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'widget boundary is not activated'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER rooms_widget_boundary BEFORE INSERT OR UPDATE ON rooms
      FOR EACH ROW EXECUTE FUNCTION enforce_room_widget_boundary();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM widget_boundary_activation WHERE widget_boundary_required)
        OR EXISTS (SELECT 1 FROM rooms WHERE kind = 'widget') THEN
        RAISE EXCEPTION 'activated widget boundary requires separately reviewed recovery';
      END IF;
    END $$;
    DROP TRIGGER rooms_widget_boundary ON rooms;
    DROP FUNCTION enforce_room_widget_boundary();
    DROP TABLE widget_boundary_activation;
    DROP FUNCTION preserve_widget_boundary_floor();
    ALTER TABLE rooms DROP CONSTRAINT rooms_widget_shape_check, DROP CONSTRAINT rooms_kind_check,
      DROP COLUMN widget_chat_enabled, DROP COLUMN kind;
  `);
}
