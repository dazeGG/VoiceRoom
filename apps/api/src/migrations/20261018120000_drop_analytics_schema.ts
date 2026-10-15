// The analytics schema served the separate status dashboard, which the
// in-app admin panel replaced: the panel reads the tables themselves, so the
// md5-keyed views and the read-only role that used them go. The tables they
// showed (activity days, quarter-hour peaks, voice stays) stay. A rollback
// brings the views back exactly as 20261015140000 made them; the role is the
// operator's to recreate (docs/SELF_HOSTING.md in 2.9.0).

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropSchema('analytics', { ifExists: true, cascade: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
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
