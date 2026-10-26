// Native-confirmed channel capabilities. Empty means a legacy installation.
import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('device_tokens', {
    notification_channels: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") }
  });
  pgm.addConstraint('device_tokens', 'device_tokens_notification_channels_check', {
    check:
      "notification_channels <@ ARRAY['messages', 'mentions', 'calls']::text[] AND cardinality(notification_channels) <= 3 AND array_position(notification_channels, NULL) IS NULL"
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('device_tokens', ['notification_channels']);
}
