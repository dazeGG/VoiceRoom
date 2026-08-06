'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('message_attachments', {
    id: { type: 'uuid', primaryKey: true },
    owner_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    context: { type: 'varchar(8)', notNull: true },
    state: { type: 'varchar(16)', notNull: true, default: 'uploading' },
    client_request_id: { type: 'varchar(128)' },
    reserved_bytes: { type: 'bigint' },
    reservation_expires_at: { type: 'timestamptz' },
    mime_type: { type: 'varchar(32)' },
    original_bytes: { type: 'bigint' },
    processed_bytes: { type: 'bigint' },
    preview_bytes: { type: 'bigint' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    original_storage_key: { type: 'text' },
    processed_storage_key: { type: 'text' },
    preview_storage_key: { type: 'text' },
    room_message_id: {
      type: 'varchar(64)',
      references: 'room_messages(id)'
    },
    direct_message_id: {
      type: 'varchar(36)',
      references: 'direct_messages(id)'
    },
    attachment_order: { type: 'smallint' },
    failure_code: { type: 'varchar(64)' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    uploaded_at: { type: 'timestamptz' },
    ready_at: { type: 'timestamptz' },
    failed_at: { type: 'timestamptz' },
    bound_at: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' }
  });

  pgm.addConstraint('message_attachments', 'message_attachments_context_check', {
    check: "context IN ('room', 'dm')"
  });
  pgm.addConstraint('message_attachments', 'message_attachments_state_check', {
    check: "state IN ('uploading', 'processing', 'ready', 'failed', 'deleted')"
  });
  pgm.addConstraint('message_attachments', 'message_attachments_mime_check', {
    check: "mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/png', 'image/webp')"
  });
  pgm.addConstraint('message_attachments', 'message_attachments_dimensions_check', {
    check: '(width IS NULL AND height IS NULL) OR (width BETWEEN 1 AND 16384 AND height BETWEEN 1 AND 16384)'
  });
  pgm.addConstraint('message_attachments', 'message_attachments_bytes_check', {
    check: `
      (original_bytes IS NULL OR original_bytes BETWEEN 1 AND 10485760) AND
      (reserved_bytes IS NULL OR reserved_bytes BETWEEN 1 AND 10485760) AND
      (processed_bytes IS NULL OR processed_bytes > 0) AND
      (preview_bytes IS NULL OR preview_bytes > 0)
    `
  });
  pgm.addConstraint('message_attachments', 'message_attachments_binding_check', {
    check: `
      (room_message_id IS NULL OR direct_message_id IS NULL) AND
      ((room_message_id IS NULL AND direct_message_id IS NULL AND attachment_order IS NULL AND bound_at IS NULL) OR
       (context = 'room' AND room_message_id IS NOT NULL AND direct_message_id IS NULL AND attachment_order BETWEEN 0 AND 3 AND bound_at IS NOT NULL) OR
       (context = 'dm' AND direct_message_id IS NOT NULL AND room_message_id IS NULL AND attachment_order BETWEEN 0 AND 3 AND bound_at IS NOT NULL))
    `
  });
  pgm.addConstraint('message_attachments', 'message_attachments_ready_check', {
    check: `
      state <> 'ready' OR (
        mime_type IS NOT NULL AND original_bytes IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND
        original_storage_key IS NOT NULL AND processed_storage_key IS NOT NULL AND preview_storage_key IS NOT NULL AND
        processed_bytes IS NOT NULL AND preview_bytes IS NOT NULL AND ready_at IS NOT NULL AND failure_code IS NULL
      )
    `
  });
  pgm.addConstraint('message_attachments', 'message_attachments_deleted_check', {
    check: "(state = 'deleted') = (deleted_at IS NOT NULL)"
  });

  pgm.createIndex('message_attachments', ['room_message_id', 'attachment_order'], {
    name: 'message_attachments_room_order_unique_idx',
    unique: true,
    where: 'room_message_id IS NOT NULL'
  });
  pgm.createIndex('message_attachments', ['direct_message_id', 'attachment_order'], {
    name: 'message_attachments_dm_order_unique_idx',
    unique: true,
    where: 'direct_message_id IS NOT NULL'
  });
  pgm.createIndex('message_attachments', ['owner_id', 'created_at', 'id'], {
    name: 'message_attachments_owner_drafts_idx',
    where: 'bound_at IS NULL AND deleted_at IS NULL'
  });
  pgm.createIndex('message_attachments', ['owner_id', 'context', 'client_request_id'], {
    name: 'message_attachments_client_request_unique_idx',
    unique: true,
    where: 'client_request_id IS NOT NULL'
  });
  pgm.createIndex('message_attachments', ['owner_id', 'state', 'created_at', 'id'], {
    name: 'message_attachments_owner_quota_idx',
    where: "state IN ('uploading', 'processing', 'ready')"
  });
  pgm.createIndex('message_attachments', ['state', 'updated_at', 'id'], {
    name: 'message_attachments_cleanup_idx',
    where: "state IN ('uploading', 'failed', 'ready', 'deleted')"
  });
  pgm.createIndex('message_attachments', ['state', 'id'], {
    name: 'message_attachments_processing_idx',
    where: "state = 'processing'"
  });

  pgm.sql(`
    CREATE FUNCTION enforce_message_attachment_state_transition()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.state = OLD.state THEN
        RETURN NEW;
      END IF;
      IF NOT (
        (OLD.state = 'uploading' AND NEW.state IN ('processing', 'failed', 'deleted')) OR
        (OLD.state = 'processing' AND NEW.state IN ('ready', 'failed', 'deleted')) OR
        (OLD.state = 'failed' AND NEW.state IN ('processing', 'deleted')) OR
        (OLD.state = 'ready' AND NEW.state IN ('failed', 'deleted'))
      ) THEN
        RAISE EXCEPTION 'illegal message attachment state transition: % -> %', OLD.state, NEW.state
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER message_attachments_state_transition_trigger
      BEFORE UPDATE OF state ON message_attachments
      FOR EACH ROW EXECUTE FUNCTION enforce_message_attachment_state_transition();
  `);

  pgm.createTable('media_processing_jobs', {
    id: { type: 'uuid', primaryKey: true },
    attachment_id: {
      type: 'uuid',
      notNull: true,
      references: 'message_attachments(id)',
      onDelete: 'CASCADE'
    },
    kind: { type: 'varchar(16)', notNull: true, default: 'process' },
    state: { type: 'varchar(16)', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    available_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    claimed_by: { type: 'text' },
    claimed_at: { type: 'timestamptz' },
    lease_expires_at: { type: 'timestamptz' },
    fencing_token: { type: 'bigint', notNull: true, default: 0 },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    completed_at: { type: 'timestamptz' },
    dead_at: { type: 'timestamptz' }
  });
  pgm.addConstraint('media_processing_jobs', 'media_processing_jobs_kind_check', {
    check: "kind IN ('process', 'cleanup')"
  });
  pgm.addConstraint('media_processing_jobs', 'media_processing_jobs_state_check', {
    check: "state IN ('pending', 'processing', 'completed', 'dead')"
  });
  pgm.addConstraint('media_processing_jobs', 'media_processing_jobs_attempts_check', {
    check: 'attempts >= 0'
  });
  pgm.addConstraint('media_processing_jobs', 'media_processing_jobs_lease_check', {
    check: `
      (state = 'processing' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND fencing_token > 0) OR
      (state <> 'processing' AND claimed_by IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL)
    `
  });
  pgm.addConstraint('media_processing_jobs', 'media_processing_jobs_terminal_check', {
    check: `
      (state = 'completed') = (completed_at IS NOT NULL) AND
      (state = 'dead') = (dead_at IS NOT NULL)
    `
  });
  pgm.createIndex('media_processing_jobs', ['attachment_id', 'kind'], {
    name: 'media_processing_jobs_active_unique_idx',
    unique: true,
    where: "state IN ('pending', 'processing')"
  });
  pgm.createIndex('media_processing_jobs', ['kind', 'available_at', 'created_at', 'id'], {
    name: 'media_processing_jobs_claim_idx',
    where: "state = 'pending'"
  });
  pgm.createIndex('media_processing_jobs', ['lease_expires_at', 'id'], {
    name: 'media_processing_jobs_expired_lease_idx',
    where: "state = 'processing'"
  });
  pgm.createIndex('media_processing_jobs', ['state', 'updated_at', 'id'], {
    name: 'media_processing_jobs_cleanup_idx',
    where: "state IN ('completed', 'dead')"
  });
  pgm.sql(`
    CREATE FUNCTION enforce_media_processing_job_state_transition()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.state = OLD.state THEN
        RETURN NEW;
      END IF;
      IF NOT (
        (OLD.state = 'pending' AND NEW.state = 'processing') OR
        (OLD.state = 'processing' AND NEW.state IN ('pending', 'completed', 'dead'))
      ) THEN
        RAISE EXCEPTION 'illegal media job state transition: % -> %', OLD.state, NEW.state
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER media_processing_jobs_state_transition_trigger
      BEFORE UPDATE OF state ON media_processing_jobs
      FOR EACH ROW EXECUTE FUNCTION enforce_media_processing_job_state_transition();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS media_processing_jobs_state_transition_trigger ON media_processing_jobs');
  pgm.sql('DROP FUNCTION IF EXISTS enforce_media_processing_job_state_transition()');
  pgm.dropTable('media_processing_jobs');
  pgm.sql('DROP TRIGGER IF EXISTS message_attachments_state_transition_trigger ON message_attachments');
  pgm.sql('DROP FUNCTION IF EXISTS enforce_message_attachment_state_transition()');
  pgm.dropTable('message_attachments');
};
