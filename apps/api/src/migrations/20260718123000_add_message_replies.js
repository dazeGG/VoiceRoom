'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('room_messages', {
    reply_to_message_id: { type: 'varchar(64)' }
  });
  pgm.addColumn('direct_messages', {
    reply_to_message_id: { type: 'varchar(36)' }
  });

  // Deliberately no foreign key: retention may physically purge a target while
  // replies keep a terminal tombstone projection of the immutable pointer.
  pgm.createIndex('room_messages', ['room_id', 'reply_to_message_id'], {
    name: 'room_messages_reply_target_idx',
    where: 'reply_to_message_id IS NOT NULL'
  });
  pgm.createIndex('direct_messages', ['reply_to_message_id'], {
    name: 'direct_messages_reply_target_idx',
    where: 'reply_to_message_id IS NOT NULL'
  });

  pgm.sql(`
    CREATE FUNCTION reject_message_reply_pointer_update()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.reply_to_message_id IS DISTINCT FROM NEW.reply_to_message_id THEN
        RAISE EXCEPTION 'reply_to_message_id is immutable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER room_messages_reply_pointer_immutable
    BEFORE UPDATE OF reply_to_message_id ON room_messages
    FOR EACH ROW EXECUTE FUNCTION reject_message_reply_pointer_update();

    CREATE TRIGGER direct_messages_reply_pointer_immutable
    BEFORE UPDATE OF reply_to_message_id ON direct_messages
    FOR EACH ROW EXECUTE FUNCTION reject_message_reply_pointer_update();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS direct_messages_reply_pointer_immutable ON direct_messages;
    DROP TRIGGER IF EXISTS room_messages_reply_pointer_immutable ON room_messages;
    DROP FUNCTION IF EXISTS reject_message_reply_pointer_update();
  `);
  pgm.dropIndex('direct_messages', [], { name: 'direct_messages_reply_target_idx' });
  pgm.dropIndex('room_messages', [], { name: 'room_messages_reply_target_idx' });
  pgm.dropColumn('direct_messages', 'reply_to_message_id');
  pgm.dropColumn('room_messages', 'reply_to_message_id');
};
