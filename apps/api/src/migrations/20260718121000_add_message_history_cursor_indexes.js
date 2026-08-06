'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  // room_messages_room_created_idx already supplies the exact active
  // (room_id, created_at, id) tuple and supports a backward cursor scan.
  // Direct-message indexes predate soft deletion, so cursor reads get partial
  // tuple indexes that avoid carrying deleted rows through long threads.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS direct_messages_sender_history_cursor_idx
      ON direct_messages (sender_id, recipient_id, created_at DESC, id DESC)
      WHERE deleted_at IS NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS direct_messages_recipient_history_cursor_idx
      ON direct_messages (recipient_id, sender_id, created_at DESC, id DESC)
      WHERE deleted_at IS NULL
  `);
};

// Cursor indexes are additive and safe for the previous application binary.
// Application rollback intentionally retains them.
exports.down = () => {};
