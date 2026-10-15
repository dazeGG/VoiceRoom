// Product analytics: which accounts were active on which day (and from which
// kind of client), the peak live numbers of each quarter hour, and the
// `analytics` schema a read-only dashboard role reads.
//
// The views carry no names, logins, message texts or room codes: accounts and
// rooms appear only as md5 keys (a temporary room's id is its join code), so a
// role granted SELECT on the schema learns how the product is used, not who
// said what where. They run with their owner's rights, so that role needs no
// grant on a base table. The role itself is created by the operator: roles are
// cluster-wide, and a migration must not depend on a password.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('user_activity_days', {
    user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    day: { type: 'date', notNull: true },
    desktop_app: { type: 'boolean', notNull: true, default: false },
    mobile: { type: 'boolean', notNull: true, default: false },
    browser: { type: 'boolean', notNull: true, default: false }
  });
  pgm.addConstraint('user_activity_days', 'user_activity_days_pkey', { primaryKey: ['user_id', 'day'] });
  pgm.createIndex('user_activity_days', ['day'], { name: 'user_activity_days_day_idx' });

  pgm.createTable('product_snapshots', {
    at: { type: 'timestamptz', primaryKey: true },
    online_accounts: { type: 'integer', notNull: true, default: 0 },
    guest_connections: { type: 'integer', notNull: true, default: 0 },
    voice_peers: { type: 'integer', notNull: true, default: 0 },
    voice_rooms: { type: 'integer', notNull: true, default: 0 }
  });

  pgm.createSchema('analytics');
  pgm.sql(`
    CREATE VIEW analytics.accounts AS
      SELECT md5(id) AS user_key, created_at, deleted_at IS NOT NULL AS deleted
      FROM public.users;

    CREATE VIEW analytics.activity_days AS
      SELECT md5(user_id) AS user_key, day, desktop_app, mobile, browser
      FROM public.user_activity_days;

    CREATE VIEW analytics.messages AS
      SELECT 'room'::text AS kind, md5(room_id) AS room_key, md5(author_user_id) AS author_key,
             created_at, deleted_at IS NOT NULL AS deleted
      FROM public.room_messages
      UNION ALL
      SELECT 'dm'::text, NULL, md5(sender_id), created_at, deleted_at IS NOT NULL
      FROM public.direct_messages;

    CREATE VIEW analytics.rooms AS
      SELECT md5(id) AS room_key, is_static, owner_id IS NOT NULL AS has_owner, created_at, deleted_at
      FROM public.rooms;

    CREATE VIEW analytics.voice_sessions AS
      SELECT md5(room_id) AS room_key, md5(user_id) AS user_key, joined_at, left_at
      FROM public.voice_sessions;

    CREATE VIEW analytics.snapshots AS
      SELECT at, online_accounts, guest_connections, voice_peers, voice_rooms
      FROM public.product_snapshots;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropSchema('analytics', { cascade: true });
  pgm.dropTable('product_snapshots');
  pgm.dropTable('user_activity_days');
}
