'use strict';

exports.shorthands = undefined;

// Before 2.5 a user could add a static room to their list (room_bookmarks)
// without becoming a member, while 2.5 reads room_memberships for the member
// list, mentions and reactions. Promote every such bookmark to a member row,
// skipping users with an active ban in that room. Existing rows, including
// owners, are left untouched.
const SOURCE = 'bookmark_backfill';

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at, metadata)
    SELECT md5(bookmark.room_id || ':' || bookmark.user_id || ':member'),
           bookmark.room_id,
           bookmark.user_id,
           'member',
           bookmark.created_at,
           current_timestamp,
           jsonb_build_object('source', '${SOURCE}')
    FROM room_bookmarks bookmark
    JOIN rooms room ON room.id = bookmark.room_id
    WHERE room.is_static = true
      AND room.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM room_bans ban
        WHERE ban.room_id = bookmark.room_id
          AND ban.user_id = bookmark.user_id
          AND ban.revoked_at IS NULL
          AND (ban.expires_at IS NULL OR ban.expires_at > current_timestamp)
      )
    ON CONFLICT (room_id, user_id) DO NOTHING
  `);
};

// Removes only the rows this migration created. A backfilled member who later
// joined keeps the marker (metadata is merged on upsert), so rolling back also
// drops that membership; the next join recreates it.
exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    DELETE FROM room_memberships
    WHERE role = 'member'
      AND metadata->>'source' = '${SOURCE}'
  `);
};
