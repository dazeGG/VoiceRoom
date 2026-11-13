import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('device_tokens', {
    locale: { type: 'text', notNull: true, default: 'ru' },
    registration_version: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()') }
  });
  pgm.addConstraint('device_tokens', 'device_tokens_locale_check', { check: "locale IN ('ru', 'en', 'fr')" });
  pgm.sql(`UPDATE push_subscriptions SET metadata = COALESCE(metadata, '{}'::jsonb) ||
    jsonb_build_object('locale', 'ru', 'registrationVersion', gen_random_uuid()::text)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('device_tokens', ['locale', 'registration_version']);
  pgm.sql("UPDATE push_subscriptions SET metadata = metadata - 'locale' - 'registrationVersion'");
}
