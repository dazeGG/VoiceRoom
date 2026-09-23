'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  // room_messages: author who sent (account id) for ownership checks on delete.
  // nullable so guests and legacy messages keep working; FK set null on user delete.
  pgm.addColumn('room_messages', {
    author_user_id: {
      type: 'varchar(36)',
      references: 'users(id)',
      onDelete: 'SET NULL'
    }
  });

  // Make an index for owner lookup if needed (author + room).
  pgm.createIndex('room_messages', ['room_id', 'author_user_id'], {
    name: 'room_messages_room_author_idx'
  });

  // direct_messages: soft delete support so delete removes for both sides.
  pgm.addColumn('direct_messages', {
    deleted_at: { type: 'timestamptz' }
  });

  // Recreate unread partial index to also exclude deleted.
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_unread_idx' });
  pgm.createIndex('direct_messages', ['recipient_id'], {
    name: 'direct_messages_unread_idx',
    where: 'read_at IS NULL AND deleted_at IS NULL'
  });

  // Thread indexes: add filtered variants that exclude deleted (for performance on active threads).
  // Keep old indexes for now (harmless); create new filtered ones used by queries.
  pgm.createIndex('direct_messages', ['sender_id', 'recipient_id', 'created_at', 'id'], {
    name: 'direct_messages_sender_thread_active_idx',
    where: 'deleted_at IS NULL'
  });
  pgm.createIndex('direct_messages', ['recipient_id', 'sender_id', 'created_at', 'id'], {
    name: 'direct_messages_recipient_thread_active_idx',
    where: 'deleted_at IS NULL'
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_recipient_thread_active_idx' });
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_sender_thread_active_idx' });

  // restore old unread
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_unread_idx' });
  pgm.createIndex('direct_messages', ['recipient_id'], {
    name: 'direct_messages_unread_idx',
    where: 'read_at IS NULL'
  });

  pgm.dropColumn('direct_messages', 'deleted_at');
  pgm.dropIndex('room_messages', [], { name: 'room_messages_room_author_idx' });
  pgm.dropColumn('room_messages', 'author_user_id');
};
