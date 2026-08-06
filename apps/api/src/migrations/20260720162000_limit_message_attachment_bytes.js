'use strict';

exports.shorthands = undefined;
const constraint = 'message_attachments_bytes_check';
const check = (maximum) => `(original_bytes IS NULL OR original_bytes BETWEEN 1 AND ${maximum}) AND (reserved_bytes IS NULL OR reserved_bytes BETWEEN 1 AND ${maximum}) AND (processed_bytes IS NULL OR processed_bytes > 0) AND (preview_bytes IS NULL OR preview_bytes > 0)`;
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropConstraint('message_attachments', constraint);
  pgm.addConstraint('message_attachments', constraint, { check: check(10485760) });
};
exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropConstraint('message_attachments', constraint);
  pgm.addConstraint('message_attachments', constraint, { check: check(20971520) });
};
