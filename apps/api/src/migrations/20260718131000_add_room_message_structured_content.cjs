'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`SET lock_timeout = '5s'`);
  pgm.addColumn('room_messages', {
    content: { type: 'jsonb' }
  }, { ifNotExists: true });
  pgm.sql(`
    DO $$
    DECLARE changed integer;
    BEGIN
      LOOP
        WITH batch AS (
          SELECT ctid FROM room_messages
          WHERE content IS NULL AND text <> ''
          LIMIT 1000
          FOR UPDATE SKIP LOCKED
        )
        UPDATE room_messages message
        SET content = jsonb_build_object(
          'version', 1,
          'segments', jsonb_build_array(jsonb_build_object('type', 'text', 'text', message.text))
        )
        FROM batch WHERE message.ctid = batch.ctid;
        GET DIAGNOSTICS changed = ROW_COUNT;
        EXIT WHEN changed = 0;
      END LOOP;
    END $$
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn('room_messages', 'content', { ifExists: true });
};
