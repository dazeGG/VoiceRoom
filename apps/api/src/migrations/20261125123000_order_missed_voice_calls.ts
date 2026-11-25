import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    CREATE SEQUENCE call_missed_revision_seq MAXVALUE 9007199254740991;
    DROP INDEX direct_messages_missed_voice_calls_idx;
    CREATE INDEX direct_messages_missed_voice_calls_idx
      ON direct_messages (recipient_id, sender_id, ((metadata#>>'{missedWatermark,order}')::bigint) DESC)
      WHERE deleted_at IS NULL AND metadata->>'kind' = 'voice-call'
        AND jsonb_typeof(metadata#>'{call,missedAt}') = 'number'
        AND metadata#>>'{call,missedSeenRevision}' IS NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    DROP INDEX direct_messages_missed_voice_calls_idx;
    CREATE INDEX direct_messages_missed_voice_calls_idx
      ON direct_messages (recipient_id, sender_id, (metadata->'call'->>'missedAt'), id)
      WHERE deleted_at IS NULL AND metadata->>'kind' = 'voice-call'
        AND jsonb_typeof(metadata->'call'->'missedAt') = 'number';
    DROP SEQUENCE call_missed_revision_seq;
  `);
}
