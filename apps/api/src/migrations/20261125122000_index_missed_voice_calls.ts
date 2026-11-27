import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    CREATE INDEX direct_messages_missed_voice_calls_idx
      ON direct_messages (recipient_id, sender_id, (metadata->'call'->>'missedAt'), id)
      WHERE deleted_at IS NULL AND metadata->>'kind' = 'voice-call'
        AND jsonb_typeof(metadata->'call'->'missedAt') = 'number';
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_missed_voice_calls_idx' });
}
