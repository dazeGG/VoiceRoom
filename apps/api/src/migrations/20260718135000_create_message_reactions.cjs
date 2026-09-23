'use strict';

exports.shorthands = undefined;

function createReactionTables(pgm, prefix, messageTable, messageIdType) {
  const revisions = `${prefix}_message_reaction_revisions`;
  const reactions = `${prefix}_message_reactions`;

  pgm.createTable(revisions, {
    message_id: {
      type: messageIdType,
      notNull: true,
      references: `${messageTable}(id)`,
      onDelete: 'CASCADE'
    },
    emoji: { type: 'text', notNull: true },
    revision: { type: 'bigint', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint(revisions, `${revisions}_pk`, {
    primaryKey: ['message_id', 'emoji']
  });
  pgm.addConstraint(revisions, `${revisions}_revision_check`, {
    check: 'revision >= 0'
  });

  pgm.createTable(reactions, {
    message_id: {
      type: messageIdType,
      notNull: true,
      references: `${messageTable}(id)`,
      onDelete: 'CASCADE'
    },
    emoji: { type: 'text', notNull: true },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    revision: { type: 'bigint', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint(reactions, `${reactions}_pk`, {
    primaryKey: ['message_id', 'emoji', 'user_id']
  });
  pgm.addConstraint(reactions, `${reactions}_revision_check`, {
    check: 'revision > 0'
  });
  pgm.createIndex(reactions, ['message_id', 'emoji', 'created_at', 'user_id'], {
    name: `${reactions}_reactors_idx`
  });
  pgm.createIndex(reactions, ['user_id', 'message_id'], {
    name: `${reactions}_user_message_idx`
  });
}

exports.up = (pgm) => {
  createReactionTables(pgm, 'room', 'room_messages', 'varchar(64)');
  createReactionTables(pgm, 'direct', 'direct_messages', 'varchar(36)');
};

exports.down = (pgm) => {
  pgm.dropTable('direct_message_reactions');
  pgm.dropTable('direct_message_reaction_revisions');
  pgm.dropTable('room_message_reactions');
  pgm.dropTable('room_message_reaction_revisions');
};
