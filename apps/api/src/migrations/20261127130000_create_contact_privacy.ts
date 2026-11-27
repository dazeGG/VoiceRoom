import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';

    CREATE TABLE contact_allow_list (
      owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('messages', 'calls')),
      allowed_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT current_timestamp,
      PRIMARY KEY (owner_id, kind, allowed_id)
    );
    CREATE INDEX contact_allow_list_allowed_idx ON contact_allow_list (allowed_id);

    CREATE TABLE dm_pair_state (
      user_low text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      initiator_id text NOT NULL,
      first_message_at timestamptz NOT NULL,
      last_sender_id text NOT NULL,
      unanswered_count integer NOT NULL CHECK (unanswered_count >= 0),
      started_as_strangers boolean NOT NULL DEFAULT false,
      PRIMARY KEY (user_low, user_high),
      CHECK (user_low < user_high),
      CHECK (initiator_id IN (user_low, user_high)),
      CHECK (last_sender_id IN (user_low, user_high))
    );
    CREATE INDEX dm_pair_state_initiator_activity_idx ON dm_pair_state (initiator_id, first_message_at);
    CREATE INDEX dm_pair_state_high_idx ON dm_pair_state (user_high);

    WITH history AS (
      SELECT least(sender_id, recipient_id) AS user_low, greatest(sender_id, recipient_id) AS user_high,
        sender_id, created_at, id, metadata->>'kind' AS kind, false AS is_rering
      FROM direct_messages
      WHERE sender_id <> recipient_id
      UNION ALL
      -- Calls store only the latest attempt. Pruned calls and overwritten attempts fall back to message history.
      SELECT least(r.caller_user_id, r.recipient_user_id), greatest(r.caller_user_id, r.recipient_user_id),
        r.attempt_inviter_user_id, r.ringing_expires_at - interval '45 seconds', m.id, 'voice-call', true
      FROM room_rings r
      JOIN direct_messages m ON m.id = r.invite_message_id
      WHERE r.purpose = 'voice-call' AND r.attempt > 1 AND r.ringing_expires_at IS NOT NULL
        AND m.metadata->>'kind' = 'voice-call'
    ), ordered AS (
      SELECT *, first_value(sender_id) OVER pair AS last_sender_id,
        row_number() OVER pair AS position
      FROM history
      WINDOW pair AS (PARTITION BY user_low, user_high ORDER BY created_at DESC, is_rering DESC, id DESC)
    ), trailing_events AS (
      SELECT *, min(position) FILTER (WHERE sender_id <> last_sender_id)
        OVER (PARTITION BY user_low, user_high) AS first_peer_position
      FROM ordered
    )
    INSERT INTO dm_pair_state (user_low, user_high, initiator_id, first_message_at, last_sender_id, unanswered_count)
    SELECT user_low, user_high, (array_agg(sender_id ORDER BY position DESC))[1], min(created_at),
      last_sender_id, count(*) FILTER (
        WHERE (first_peer_position IS NULL OR position < first_peer_position)
          AND kind IS DISTINCT FROM 'voice-call' AND kind IS DISTINCT FROM 'room-invite'
      )
    FROM trailing_events
    GROUP BY user_low, user_high, last_sender_id;

    -- Acquire the exclusive users lock after backfilling history so it is held only for the final ALTER.
    ALTER TABLE users
      ADD COLUMN messages_from text NOT NULL DEFAULT 'everyone'
        CHECK (messages_from IN ('everyone', 'friends', 'selected')),
      ADD COLUMN calls_from text NOT NULL DEFAULT 'friends'
        CHECK (calls_from IN ('everyone', 'friends', 'selected'));
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    DROP TABLE dm_pair_state, contact_allow_list;
    ALTER TABLE users DROP COLUMN messages_from, DROP COLUMN calls_from;
  `);
}
