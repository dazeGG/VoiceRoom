import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE room_rings (
      id uuid PRIMARY KEY,
      caller_user_id varchar(36) NOT NULL,
      recipient_user_id varchar(36) NOT NULL,
      room_id varchar(64) NOT NULL,
      client_request_id uuid NOT NULL,
      invite_message_id varchar(36) NOT NULL,
      state text NOT NULL DEFAULT 'pending',
      revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL,
      ended_at timestamptz,
      reason text,
      CONSTRAINT room_rings_not_self CHECK(caller_user_id <> recipient_user_id),
      CONSTRAINT room_rings_lifetime CHECK(expires_at > created_at),
      CONSTRAINT room_rings_state CHECK(
        (state = 'pending' AND revision = 1 AND ended_at IS NULL AND reason IS NULL) OR
        (state IN ('accepted','declined','cancelled','expired') AND revision = 2 AND ended_at IS NOT NULL)
      ),
      CONSTRAINT room_rings_reason CHECK(reason IS NULL OR (state = 'cancelled' AND reason IN ('caller_cancelled','unavailable'))),
      UNIQUE(caller_user_id, client_request_id)
    );
    CREATE INDEX room_rings_expiry_idx ON room_rings(expires_at) WHERE state='pending';
    CREATE INDEX room_rings_retention_idx ON room_rings(created_at);
    CREATE INDEX room_rings_pair_idx ON room_rings(caller_user_id, recipient_user_id, created_at DESC);
    CREATE TABLE ring_delivery_outbox (
      ring_id uuid NOT NULL REFERENCES room_rings(id) ON DELETE CASCADE,
      revision integer NOT NULL,
      recipient_user_id varchar(36) NOT NULL,
      kind text NOT NULL CHECK(kind IN ('incoming','terminal')),
      deadline timestamptz NOT NULL,
      available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      claim_token uuid,
      claimed_until timestamptz,
      PRIMARY KEY(ring_id, revision, recipient_user_id),
      CONSTRAINT ring_delivery_claim CHECK((claim_token IS NULL) = (claimed_until IS NULL))
    );
    CREATE INDEX ring_delivery_available_idx ON ring_delivery_outbox(available_at);
  `);
}
export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('ring_delivery_outbox');
  pgm.dropTable('room_rings');
}
