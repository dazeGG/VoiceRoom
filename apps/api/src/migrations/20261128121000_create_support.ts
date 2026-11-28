// The admin app's support inbox. A thread per person who wrote to the
// official account (open until staff resolve it, reopened by their next
// message), staff notes on it, and which staff member sent each answer. The
// answer itself is an ordinary direct message from the official account, so
// the staff id lives only here, never in a message payload. Notes and the
// thread outlive a deleted conversation; an answer's row goes with its message.
// Staff actions on a thread go into admin_actions like any other.

import type { MigrationBuilder } from 'node-pg-migrate';

const ACTIONS = "'block', 'unblock', 'logout', 'delete', 'cancel_deletion', 'badge', 'staff_role'";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';

    CREATE TABLE support_threads (
      user_id varchar(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      last_user_message_at timestamptz,
      staff_read_at timestamptz,
      resolved_at timestamptz,
      resolved_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
      CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
    );
    CREATE INDEX support_threads_status_idx ON support_threads (status, last_user_message_at DESC);

    CREATE TABLE support_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar(36) NOT NULL REFERENCES support_threads(user_id) ON DELETE CASCADE,
      author_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
      body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT current_timestamp
    );
    CREATE INDEX support_notes_user_idx ON support_notes (user_id, created_at);

    CREATE TABLE support_replies (
      message_id varchar(36) PRIMARY KEY REFERENCES direct_messages(id) ON DELETE CASCADE,
      staff_id varchar(36) REFERENCES users(id) ON DELETE SET NULL
    );

    ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_action_check;
    ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check
      CHECK (action IN (${ACTIONS}, 'support_reply', 'support_note', 'support_resolve'));
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    DELETE FROM admin_actions WHERE action IN ('support_reply', 'support_note', 'support_resolve');
    ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_action_check;
    ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check CHECK (action IN (${ACTIONS}));
    DROP TABLE support_replies, support_notes, support_threads;
  `);
}
