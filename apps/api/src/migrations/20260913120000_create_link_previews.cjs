'use strict';

exports.shorthands = undefined;

// A link is fetched once and its preview reused: this cache keeps what a page
// offered, or that it offered nothing, for a while. Messages carry their own
// snapshot in metadata.linkPreview, so an expired row never changes a message.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('link_previews', {
    url_hash: { type: 'char(64)', primaryKey: true },
    url: { type: 'text', notNull: true },
    status: { type: 'varchar(16)', notNull: true },
    preview: { type: 'jsonb' },
    failure_code: { type: 'varchar(32)' },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz', notNull: true }
  });
  pgm.addConstraint('link_previews', 'link_previews_status_check', {
    check: "status IN ('ready', 'failed') AND ((status = 'ready') = (preview IS NOT NULL))"
  });
  pgm.createIndex('link_previews', ['expires_at'], { name: 'link_previews_expires_at_idx' });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('link_previews');
};
