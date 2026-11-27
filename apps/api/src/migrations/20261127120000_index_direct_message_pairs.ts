import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    CREATE INDEX direct_messages_pair_activity_idx
      ON direct_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at DESC);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_pair_activity_idx' });
}
