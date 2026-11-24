import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('native_voice_leases', {
    id: { type: 'uuid', primaryKey: true },
    // Keep the removal work even if the app room is hard-deleted.
    room_id: { type: 'varchar(48)', notNull: true },
    peer_id: { type: 'varchar(80)', notNull: true },
    generation: { type: 'varchar(32)', notNull: true },
    account_id: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    valid_until: { type: 'timestamptz' },
    retired_at: { type: 'timestamptz' },
    cleanup_exhausted_at: { type: 'timestamptz' }
  });
  pgm.addConstraint('native_voice_leases', 'native_voice_leases_room_peer_key', {
    unique: ['room_id', 'peer_id']
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('native_voice_leases');
}
