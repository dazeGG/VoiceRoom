import type { MigrationBuilder } from 'node-pg-migrate';

// The reported DM as it stood when it was reported, built from `m`.
const snapshotOf = `jsonb_build_object(
  'text', m.body,
  'senderId', m.sender_id,
  'createdAt', m.created_at,
  'attachments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'mimeType', a.mime_type,
      'name', a.metadata->>'originalName') ORDER BY a.attachment_order)
    FROM message_attachments a
    WHERE a.direct_message_id = m.id
  ), '[]'::jsonb)
)`;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE content_reports ADD COLUMN snapshot jsonb;

    -- A writer that predates the column (the rollback build) inserts reports
    -- without a snapshot. Capture it at insert time so deleting the
    -- conversation later cannot erase the evidence.
    CREATE FUNCTION content_reports_capture_dm_snapshot() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.target_kind = 'direct_message' AND NEW.snapshot IS NULL THEN
        SELECT ${snapshotOf} INTO NEW.snapshot FROM direct_messages m WHERE m.id = NEW.message_id;
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER content_reports_capture_dm_snapshot
      BEFORE INSERT ON content_reports
      FOR EACH ROW EXECUTE FUNCTION content_reports_capture_dm_snapshot();

    DO $$
    DECLARE
      last_id uuid;
    BEGIN
      LOOP
        WITH batch AS (
          SELECT r.id, r.message_id
          FROM content_reports r
          WHERE r.target_kind = 'direct_message'
            AND (last_id IS NULL OR r.id > last_id)
          ORDER BY r.id
          LIMIT 500
        ), updated AS (
          UPDATE content_reports r
          SET snapshot = ${snapshotOf}
          FROM batch b JOIN direct_messages m ON m.id = b.message_id
          WHERE r.id = b.id
        )
        SELECT id INTO last_id FROM batch ORDER BY id DESC LIMIT 1;
        EXIT WHEN NOT FOUND;
      END LOOP;
    END
    $$;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    DROP TRIGGER IF EXISTS content_reports_capture_dm_snapshot ON content_reports;
    DROP FUNCTION IF EXISTS content_reports_capture_dm_snapshot();
    ALTER TABLE content_reports DROP COLUMN snapshot;
  `);
}
