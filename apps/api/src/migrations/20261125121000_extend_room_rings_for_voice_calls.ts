import type { MigrationBuilder } from 'node-pg-migrate';

const inviteState = `
  (state = 'pending' AND revision = 1 AND ended_at IS NULL AND reason IS NULL) OR
  (state IN ('accepted','declined','cancelled','expired') AND revision = 2 AND ended_at IS NOT NULL)
`;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE room_rings
      ADD COLUMN purpose text NOT NULL DEFAULT 'room-invite',
      ALTER COLUMN state DROP NOT NULL,
      ALTER COLUMN revision DROP NOT NULL,
      ALTER COLUMN expires_at DROP NOT NULL,
      ALTER COLUMN invite_message_id DROP NOT NULL,
      ADD COLUMN attempt integer,
      ADD COLUMN attempt_inviter_user_id varchar(36),
      ADD COLUMN call_phase text,
      ADD COLUMN attempt_result text,
      ADD COLUMN ringing_expires_at timestamptz,
      ADD COLUMN alone_deadline timestamptz,
      ADD COLUMN started_at timestamptz,
      ADD COLUMN first_connected_at timestamptz,
      ADD COLUMN closed_at timestamptz,
      ADD COLUMN mutual_ms bigint,
      ADD COLUMN mutual_since timestamptz,
      ADD COLUMN end_reason text,
      ADD COLUMN ended_by_user_id varchar(36),
      ADD COLUMN call_revision integer,
      ADD CONSTRAINT room_rings_purpose_check CHECK (purpose IN ('room-invite', 'voice-call')),
      ADD CONSTRAINT room_rings_id_purpose_key UNIQUE (id, purpose),
      DROP CONSTRAINT room_rings_state,
      ADD CONSTRAINT room_rings_state CHECK (purpose <> 'room-invite' OR (${inviteState})),
      ADD CONSTRAINT room_rings_invite_shape_check CHECK (
        purpose <> 'room-invite' OR (
          state IS NOT NULL AND revision IS NOT NULL AND expires_at IS NOT NULL AND invite_message_id IS NOT NULL
          AND num_nonnulls(attempt, attempt_inviter_user_id, call_phase, attempt_result, ringing_expires_at,
            alone_deadline, started_at, first_connected_at, closed_at, mutual_ms, mutual_since, end_reason,
            ended_by_user_id, call_revision) = 0
        )
      ),
      ADD CONSTRAINT room_rings_call_shape_check CHECK (
        purpose <> 'voice-call' OR (
          num_nonnulls(state, revision, expires_at, ended_at, reason) = 0
          AND attempt IS NOT NULL AND attempt > 0
          AND attempt_inviter_user_id IS NOT NULL
          AND attempt_inviter_user_id IN (caller_user_id, recipient_user_id)
          AND call_phase IS NOT NULL
          AND call_phase IN ('provisioning', 'ringing', 'connecting', 'connected', 'alone', 'closed')
          AND call_revision IS NOT NULL AND call_revision >= attempt
          AND mutual_ms IS NOT NULL AND mutual_ms >= 0
          AND (ended_by_user_id IS NULL OR ended_by_user_id IN (caller_user_id, recipient_user_id))
          AND (
            (started_at IS NULL AND call_phase IN ('provisioning', 'closed')
              AND num_nonnulls(invite_message_id, ringing_expires_at, first_connected_at, attempt_result) = 0)
            OR
            (started_at IS NOT NULL AND call_phase <> 'provisioning'
              AND invite_message_id IS NOT NULL AND ringing_expires_at IS NOT NULL
              AND started_at >= created_at AND ringing_expires_at > started_at
              AND attempt_result IS NOT NULL
              AND attempt_result IN ('pending', 'accepted', 'no_answer', 'declined', 'cancelled'))
          )
          AND ((call_phase = 'ringing') = (attempt_result IS NOT DISTINCT FROM 'pending'))
          AND (call_phase NOT IN ('connecting', 'connected') OR attempt_result = 'accepted')
          AND (first_connected_at IS NOT NULL OR mutual_ms = 0)
          AND (first_connected_at IS NULL OR first_connected_at >= started_at)
          AND ((call_phase = 'connected') = (mutual_since IS NOT NULL))
          AND (mutual_since IS NULL OR (first_connected_at IS NOT NULL AND mutual_since >= first_connected_at))
          AND (call_phase NOT IN ('ringing', 'alone') OR alone_deadline IS NOT NULL)
          AND (alone_deadline IS NULL OR (
            call_phase IN ('ringing', 'connecting', 'alone') AND alone_deadline >= started_at
            AND (call_phase <> 'ringing' OR alone_deadline >= ringing_expires_at)
          ))
          AND (
            (call_phase = 'closed' AND closed_at IS NOT NULL AND closed_at >= coalesce(first_connected_at, started_at, created_at)
              AND end_reason IS NOT NULL AND end_reason IN ('ended', 'no_answer', 'declined', 'cancelled', 'alone_timeout', 'unavailable'))
            OR
            (call_phase <> 'closed' AND num_nonnulls(closed_at, end_reason, ended_by_user_id) = 0)
          )
        )
      );
    CREATE UNIQUE INDEX room_rings_open_call_pair_idx
      ON room_rings (least(caller_user_id, recipient_user_id), greatest(caller_user_id, recipient_user_id))
      WHERE purpose = 'voice-call' AND call_phase <> 'closed';
    CREATE UNIQUE INDEX room_rings_call_room_idx ON room_rings (room_id) WHERE purpose = 'voice-call';
    CREATE INDEX room_rings_call_due_idx ON room_rings (
      (CASE call_phase
        WHEN 'provisioning' THEN created_at
        WHEN 'ringing' THEN ringing_expires_at
        ELSE alone_deadline
      END)
    ) WHERE purpose = 'voice-call' AND call_phase IN ('provisioning', 'ringing', 'connecting', 'alone');

    ALTER TABLE ring_delivery_outbox
      ADD COLUMN purpose text NOT NULL DEFAULT 'room-invite',
      ADD COLUMN attempt integer,
      DROP CONSTRAINT ring_delivery_outbox_ring_id_fkey,
      DROP CONSTRAINT ring_delivery_outbox_kind_check,
      DROP CONSTRAINT ring_delivery_outbox_pkey,
      ADD CONSTRAINT ring_delivery_outbox_ring_purpose_fkey
        FOREIGN KEY (ring_id, purpose) REFERENCES room_rings (id, purpose) ON DELETE CASCADE,
      ADD CONSTRAINT ring_delivery_outbox_kind_check CHECK (
        (purpose = 'room-invite' AND kind IN ('incoming', 'terminal') AND attempt IS NULL)
        OR (purpose = 'voice-call' AND kind IN ('call-incoming', 'call-dismissal', 'call-missed')
          AND attempt IS NOT NULL AND attempt > 0)
      ),
      ADD PRIMARY KEY (ring_id, revision, recipient_user_id, kind);
    CREATE UNIQUE INDEX ring_delivery_invite_key ON ring_delivery_outbox (ring_id, revision, recipient_user_id)
      WHERE purpose = 'room-invite';
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    LOCK TABLE room_rings, ring_delivery_outbox IN ACCESS EXCLUSIVE MODE;
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM room_rings WHERE purpose = 'voice-call')
        OR EXISTS (SELECT FROM ring_delivery_outbox WHERE purpose = 'voice-call') THEN
        RAISE EXCEPTION 'Cannot roll back Ring storage while voice calls or their delivery jobs exist';
      END IF;
    END
    $$;

    DROP INDEX ring_delivery_invite_key;
    ALTER TABLE ring_delivery_outbox
      DROP CONSTRAINT ring_delivery_outbox_ring_purpose_fkey,
      DROP CONSTRAINT ring_delivery_outbox_kind_check,
      DROP CONSTRAINT ring_delivery_outbox_pkey,
      DROP COLUMN purpose,
      DROP COLUMN attempt,
      ADD CONSTRAINT ring_delivery_outbox_ring_id_fkey FOREIGN KEY (ring_id) REFERENCES room_rings (id) ON DELETE CASCADE,
      ADD CONSTRAINT ring_delivery_outbox_kind_check CHECK (kind IN ('incoming', 'terminal')),
      ADD PRIMARY KEY (ring_id, revision, recipient_user_id);

    ALTER TABLE room_rings
      DROP CONSTRAINT room_rings_state,
      DROP CONSTRAINT room_rings_invite_shape_check,
      DROP CONSTRAINT room_rings_call_shape_check,
      DROP COLUMN purpose,
      DROP COLUMN attempt,
      DROP COLUMN attempt_inviter_user_id,
      DROP COLUMN call_phase,
      DROP COLUMN attempt_result,
      DROP COLUMN ringing_expires_at,
      DROP COLUMN alone_deadline,
      DROP COLUMN started_at,
      DROP COLUMN first_connected_at,
      DROP COLUMN closed_at,
      DROP COLUMN mutual_ms,
      DROP COLUMN mutual_since,
      DROP COLUMN end_reason,
      DROP COLUMN ended_by_user_id,
      DROP COLUMN call_revision,
      ALTER COLUMN state SET NOT NULL,
      ALTER COLUMN revision SET NOT NULL,
      ALTER COLUMN expires_at SET NOT NULL,
      ALTER COLUMN invite_message_id SET NOT NULL,
      ADD CONSTRAINT room_rings_state CHECK (${inviteState});
  `);
}
