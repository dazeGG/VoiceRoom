// A stay in voice also says who and where from, without an IP address: the
// guest's name and the lasting id of its browser, the client, system and browser
// of the socket, the keyed hash of the address (lib/ip-key.ts) and its city.
// The guest fields and the origin are cleared together with room_id after
// VOICE_HISTORY_KEEP_DAYS. Rooms stop keeping their creator's address: the
// temporary-room quota counts by the same keyed hash, and deleted rooms lose
// the addresses they kept.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('voice_sessions', {
    guest_name: { type: 'varchar(40)' },
    guest_id: { type: 'uuid' },
    client: { type: 'varchar(16)' },
    os: { type: 'varchar(32)' },
    browser: { type: 'varchar(32)' },
    ip_key: { type: 'varchar(16)' },
    location: { type: 'varchar(120)' }
  });
  pgm.addConstraint('voice_sessions', 'voice_sessions_client_check', {
    check: "client IS NULL OR client IN ('desktop_app', 'mobile', 'browser')"
  });
  pgm.createIndex('voice_sessions', ['ip_key', 'joined_at'], {
    name: 'voice_sessions_ip_key_idx',
    where: 'ip_key IS NOT NULL'
  });
  pgm.sql("UPDATE rooms SET creator_ip = '' WHERE deleted_at IS NOT NULL AND creator_ip <> ''");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  // The addresses of deleted rooms are gone for good; live rooms keep what they have.
  pgm.dropIndex('voice_sessions', ['ip_key', 'joined_at'], { name: 'voice_sessions_ip_key_idx' });
  pgm.dropConstraint('voice_sessions', 'voice_sessions_client_check');
  pgm.dropColumns('voice_sessions', ['guest_name', 'guest_id', 'client', 'os', 'browser', 'ip_key', 'location']);
}
