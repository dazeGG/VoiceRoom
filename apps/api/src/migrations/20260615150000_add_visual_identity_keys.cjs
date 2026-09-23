'use strict';

exports.shorthands = undefined;

const AVATAR_COLOR_CHECK = "avatar_color_key IN ('blurple', 'violet', 'orchid', 'magenta', 'rose', 'coral', 'rust', 'amber', 'olive', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'slate')";
const ROOM_ICON_CHECK = "room_icon_key IN ('headphones', 'pin', 'moon', 'sun', 'gamepad', 'mic', 'fire', 'coffee', 'music', 'book')";
const ROOM_COLOR_CHECK = "room_color_key IN ('blue', 'slate', 'violet', 'amber', 'indigo', 'rose', 'rust', 'green')";

exports.up = (pgm) => {
  pgm.addColumns('users', {
    avatar_color_key: { type: 'varchar(32)', notNull: true, default: 'blurple' }
  });
  pgm.addConstraint('users', 'users_avatar_color_key_check', {
    check: AVATAR_COLOR_CHECK
  });

  pgm.sql(`
    WITH palette AS (
      SELECT ARRAY[
        'blurple', 'violet', 'orchid', 'magenta',
        'rose', 'coral', 'rust', 'amber',
        'olive', 'green', 'teal', 'cyan',
        'sky', 'blue', 'indigo', 'slate'
      ]::text[] AS colors
    )
    UPDATE users
    SET avatar_color_key = (
      SELECT colors[
        (mod(hashtext(users.id || ':' || users.login)::bigint + 2147483648, array_length(colors, 1)) + 1)::int
      ]
      FROM palette
    ),
    updated_at = current_timestamp
  `);

  pgm.addColumns('rooms', {
    room_icon_key: { type: 'varchar(32)', notNull: true, default: 'headphones' },
    room_color_key: { type: 'varchar(32)', notNull: true, default: 'blue' }
  });
  pgm.addConstraint('rooms', 'rooms_room_icon_key_check', {
    check: ROOM_ICON_CHECK
  });
  pgm.addConstraint('rooms', 'rooms_room_color_key_check', {
    check: ROOM_COLOR_CHECK
  });

  pgm.sql(`
    UPDATE rooms
    SET room_icon_key = CASE emoji
        WHEN '🎧' THEN 'headphones'
        WHEN '📌' THEN 'pin'
        WHEN '🌙' THEN 'moon'
        WHEN '☀️' THEN 'sun'
        WHEN '🎮' THEN 'gamepad'
        WHEN '🎙️' THEN 'mic'
        WHEN '🔥' THEN 'fire'
        ELSE room_icon_key
      END,
      room_color_key = CASE emoji
        WHEN '🎧' THEN 'blue'
        WHEN '📌' THEN 'slate'
        WHEN '🌙' THEN 'violet'
        WHEN '☀️' THEN 'amber'
        WHEN '🎮' THEN 'indigo'
        WHEN '🎙️' THEN 'rose'
        WHEN '🔥' THEN 'rust'
        ELSE room_color_key
      END,
      updated_at = current_timestamp
  `);

  pgm.createTable('room_peer_identities', {
    id: { type: 'varchar(64)', primaryKey: true },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    peer_id: { type: 'text', notNull: true },
    session_token_hash: { type: 'text', notNull: true },
    avatar_color_key: { type: 'varchar(32)', notNull: true },
    display_name: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });
  pgm.addConstraint('room_peer_identities', 'room_peer_identities_avatar_color_key_check', {
    check: AVATAR_COLOR_CHECK
  });
  pgm.createIndex('room_peer_identities', ['room_id', 'peer_id'], {
    name: 'room_peer_identities_room_peer_unique_idx',
    unique: true
  });
  pgm.createIndex('room_peer_identities', ['room_id', 'last_seen_at'], {
    name: 'room_peer_identities_room_seen_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('room_peer_identities');
  pgm.dropConstraint('rooms', 'rooms_room_color_key_check');
  pgm.dropConstraint('rooms', 'rooms_room_icon_key_check');
  pgm.dropColumns('rooms', ['room_icon_key', 'room_color_key']);
  pgm.dropConstraint('users', 'users_avatar_color_key_check');
  pgm.dropColumns('users', ['avatar_color_key']);
};
