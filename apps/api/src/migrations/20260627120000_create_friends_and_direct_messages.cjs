'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Pending/resolved friend requests. A directed edge requester -> addressee.
  // We keep resolved rows for history, but only one *pending* row may exist per
  // ordered pair (enforced by a partial unique index below).
  pgm.createTable('friend_requests', {
    id: { type: 'varchar(36)', primaryKey: true },
    requester_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    addressee_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    status: { type: 'varchar(16)', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    responded_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.addConstraint('friend_requests', 'friend_requests_status_check', {
    check: "status IN ('pending', 'accepted', 'declined', 'cancelled')"
  });
  pgm.addConstraint('friend_requests', 'friend_requests_no_self_check', {
    check: 'requester_id <> addressee_id'
  });
  // At most one pending request per ordered pair.
  pgm.createIndex('friend_requests', ['requester_id', 'addressee_id'], {
    name: 'friend_requests_pending_unique_idx',
    unique: true,
    where: "status = 'pending'"
  });
  pgm.createIndex('friend_requests', ['addressee_id', 'status'], {
    name: 'friend_requests_addressee_status_idx'
  });
  pgm.createIndex('friend_requests', ['requester_id', 'status'], {
    name: 'friend_requests_requester_status_idx'
  });

  // Undirected friendship stored once as an ordered pair (user_a_id < user_b_id)
  // so a single row covers both directions and the unique index dedupes it.
  pgm.createTable('friendships', {
    id: { type: 'varchar(36)', primaryKey: true },
    user_a_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    user_b_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.addConstraint('friendships', 'friendships_ordered_check', {
    check: 'user_a_id < user_b_id'
  });
  pgm.createIndex('friendships', ['user_a_id', 'user_b_id'], {
    name: 'friendships_pair_unique_idx',
    unique: true
  });
  pgm.createIndex('friendships', ['user_b_id'], { name: 'friendships_user_b_idx' });

  // One-to-one direct messages. read_at NULL means unread by the recipient.
  pgm.createTable('direct_messages', {
    id: { type: 'varchar(36)', primaryKey: true },
    sender_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    recipient_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    read_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.addConstraint('direct_messages', 'direct_messages_no_self_check', {
    check: 'sender_id <> recipient_id'
  });
  // Thread lookup spans both directions of a conversation, so index each
  // participant's view of the timeline.
  pgm.createIndex('direct_messages', ['sender_id', 'recipient_id', 'created_at', 'id'], {
    name: 'direct_messages_sender_thread_idx'
  });
  pgm.createIndex('direct_messages', ['recipient_id', 'sender_id', 'created_at', 'id'], {
    name: 'direct_messages_recipient_thread_idx'
  });
  // Unread badge counts: recipient + unread filter.
  pgm.createIndex('direct_messages', ['recipient_id'], {
    name: 'direct_messages_unread_idx',
    where: 'read_at IS NULL'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('direct_messages');
  pgm.dropTable('friendships');
  pgm.dropTable('friend_requests');
};
