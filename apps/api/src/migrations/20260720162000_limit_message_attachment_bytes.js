'use strict';

exports.shorthands = undefined;
const constraint = 'message_attachments_bytes_check';
const check = (maximum) => `(original_bytes IS NULL OR original_bytes BETWEEN 1 AND ${maximum}) AND (reserved_bytes IS NULL OR reserved_bytes BETWEEN 1 AND ${maximum}) AND (processed_bytes IS NULL OR processed_bytes > 0) AND (preview_bytes IS NULL OR preview_bytes > 0)`;
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropConstraint('message_attachments', constraint);
  pgm.sql(`ALTER TABLE message_attachments ADD CONSTRAINT ${constraint} CHECK (${check(10485760)}) NOT VALID`);
  pgm.sql(`
    UPDATE message_attachments
    SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{migrationRemediation}',
          jsonb_build_object(
            'reason', 'attachment_exceeds_10mib',
            'migration', '20260720162000_limit_message_attachment_bytes',
            'previousState', state,
            'originalBytes', original_bytes,
            'reservedBytes', reserved_bytes
          ),
          true
        ),
        state = 'deleted',
        failure_code = COALESCE(failure_code, 'media_oversize_10mib'),
        deleted_at = COALESCE(deleted_at, current_timestamp),
        reserved_bytes = NULL,
        reservation_expires_at = NULL,
        original_bytes = NULL,
        updated_at = current_timestamp
    WHERE original_bytes > 10485760 OR reserved_bytes > 10485760
  `);
  pgm.sql(`
    UPDATE media_processing_jobs AS job
    SET state = 'processing',
        claimed_by = 'migration:20260720162000',
        claimed_at = current_timestamp,
        lease_expires_at = current_timestamp + interval '1 second',
        fencing_token = fencing_token + 1,
        updated_at = current_timestamp
    FROM message_attachments AS attachment
    WHERE job.attachment_id = attachment.id
      AND attachment.metadata->'migrationRemediation'->>'migration' = '20260720162000_limit_message_attachment_bytes'
      AND job.state = 'pending'
  `);
  pgm.sql(`
    UPDATE media_processing_jobs AS job
    SET state = 'dead',
        claimed_by = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        dead_at = current_timestamp,
        last_error = 'attachment remediated: media_oversize_10mib',
        updated_at = current_timestamp
    FROM message_attachments AS attachment
    WHERE job.attachment_id = attachment.id
      AND attachment.metadata->'migrationRemediation'->>'migration' = '20260720162000_limit_message_attachment_bytes'
      AND job.state = 'processing'
  `);
  pgm.sql(`ALTER TABLE message_attachments VALIDATE CONSTRAINT ${constraint}`);
};
exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropConstraint('message_attachments', constraint);
  pgm.sql(`ALTER TABLE message_attachments ADD CONSTRAINT ${constraint} CHECK (${check(20971520)}) NOT VALID`);
  pgm.sql(`ALTER TABLE message_attachments VALIDATE CONSTRAINT ${constraint}`);
};
