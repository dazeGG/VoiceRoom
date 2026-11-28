import type { MigrationBuilder } from 'node-pg-migrate';

// The diagnostics file a person attaches in the VoiceRoom chat. It stays an
// ordinary direct-message attachment (`context = 'dm'`), so conversation
// delete, quota and cleanup treat it like any other; `metadata.kind` marks it.
// It is plain text and never processed, so a ready one has no dimensions and
// no processed or preview variant: the ready check asks those of images only.
//
// Both checks use NOT VALID followed by explicit validation in this migration.

const IMAGE_MIME = "mime_type IN ('image/jpeg', 'image/png', 'image/webp')";
// A CHECK passes when it evaluates to NULL, so the marker is compared null-safely.
const DIAGNOSTICS =
  "mime_type = 'text/plain' AND context = 'dm' AND (metadata->>'kind') IS NOT DISTINCT FROM 'diagnostics'";

const MIME_BEFORE = `mime_type IS NULL OR ${IMAGE_MIME}`;
const MIME_AFTER = `mime_type IS NULL OR ${IMAGE_MIME} OR (${DIAGNOSTICS})`;

const READY_COMMON =
  'mime_type IS NOT NULL AND original_bytes IS NOT NULL AND original_storage_key IS NOT NULL AND ' +
  'ready_at IS NOT NULL AND failure_code IS NULL';
const READY_IMAGE =
  'width IS NOT NULL AND height IS NOT NULL AND processed_storage_key IS NOT NULL AND ' +
  'preview_storage_key IS NOT NULL AND processed_bytes IS NOT NULL AND preview_bytes IS NOT NULL';
const READY_FILE =
  'width IS NULL AND height IS NULL AND processed_storage_key IS NULL AND preview_storage_key IS NULL AND ' +
  'processed_bytes IS NULL AND preview_bytes IS NULL';

const READY_BEFORE = `state <> 'ready' OR (${READY_COMMON} AND ${READY_IMAGE})`;
const READY_AFTER = `state <> 'ready' OR (${READY_COMMON} AND (
  (mime_type <> 'text/plain' AND ${READY_IMAGE}) OR (mime_type = 'text/plain' AND ${READY_FILE})
))`;

function replaceChecks(pgm: MigrationBuilder, mime: string, ready: string): void {
  pgm.sql(`
    ALTER TABLE message_attachments
      DROP CONSTRAINT message_attachments_mime_check,
      ADD CONSTRAINT message_attachments_mime_check CHECK (${mime}) NOT VALID,
      DROP CONSTRAINT message_attachments_ready_check,
      ADD CONSTRAINT message_attachments_ready_check CHECK (${ready}) NOT VALID;
    ALTER TABLE message_attachments
      VALIDATE CONSTRAINT message_attachments_mime_check,
      VALIDATE CONSTRAINT message_attachments_ready_check;
  `);
}

export function up(pgm: MigrationBuilder): void {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  replaceChecks(pgm, MIME_AFTER, READY_AFTER);
}

// Dev and test only: production never runs down. The diagnostics files go
// first (their processing jobs cascade), since the old checks refuse them.
export function down(pgm: MigrationBuilder): void {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql("DELETE FROM message_attachments WHERE mime_type = 'text/plain' OR metadata->>'kind' = 'diagnostics'");
  replaceChecks(pgm, MIME_BEFORE, READY_BEFORE);
}
