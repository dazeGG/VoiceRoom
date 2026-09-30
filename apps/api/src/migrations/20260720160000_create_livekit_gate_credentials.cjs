'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('livekit_gate_principal_epochs', {
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    principal_type: { type: 'text', notNull: true },
    principal_id: { type: 'text', notNull: true },
    epoch: { type: 'integer', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('livekit_gate_principal_epochs', 'livekit_gate_principal_epochs_pk', {
    primaryKey: ['room_id', 'principal_type', 'principal_id']
  });
  pgm.addConstraint('livekit_gate_principal_epochs', 'livekit_gate_principal_type_chk', {
    check: "principal_type IN ('account', 'guest')"
  });

  pgm.createTable('livekit_gate_credentials', {
    id: { type: 'varchar(36)', primaryKey: true },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    peer_id: { type: 'text', notNull: true },
    principal_type: { type: 'text', notNull: true },
    principal_id: { type: 'text', notNull: true },
    principal_epoch: { type: 'integer', notNull: true },
    credential_hash: { type: 'char(64)', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });
  pgm.addConstraint('livekit_gate_credentials', 'livekit_gate_credentials_principal_type_chk', {
    check: "principal_type IN ('account', 'guest')"
  });
  pgm.createIndex('livekit_gate_credentials', ['room_id', 'peer_id'], {
    name: 'livekit_gate_credentials_room_peer_idx'
  });
  pgm.createIndex('livekit_gate_credentials', ['room_id', 'principal_type', 'principal_id'], {
    name: 'livekit_gate_credentials_principal_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('livekit_gate_credentials');
  pgm.dropTable('livekit_gate_principal_epochs');
};
