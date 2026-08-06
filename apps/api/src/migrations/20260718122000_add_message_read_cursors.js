'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    ALTER TABLE room_chat_reads
      ADD COLUMN IF NOT EXISTS last_read_message_created_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_read_message_id varchar(64)
  `);
  pgm.sql(`
    ALTER TABLE room_chat_reads
      DROP CONSTRAINT IF EXISTS room_chat_reads_exact_cursor_pair_check,
      ADD CONSTRAINT room_chat_reads_exact_cursor_pair_check CHECK (
        (last_read_message_created_at IS NULL AND last_read_message_id IS NULL)
        OR
        (last_read_message_created_at IS NOT NULL AND last_read_message_id IS NOT NULL)
      )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS direct_message_read_cursors (
      user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_created_at timestamptz NOT NULL,
      last_read_message_id varchar(36) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT current_timestamp,
      CONSTRAINT direct_message_read_cursors_pkey PRIMARY KEY (user_id, peer_user_id),
      CONSTRAINT direct_message_read_cursors_no_self_check CHECK (user_id <> peer_user_id)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS direct_message_read_cursors_peer_idx
      ON direct_message_read_cursors (peer_user_id, user_id)
  `);
};

// Exact cursor state coexists with the legacy last_read_at/read_at projection.
// Retaining it makes application rollback non-destructive.
exports.down = () => {};
