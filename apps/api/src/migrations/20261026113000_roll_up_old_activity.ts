// Who was active or in voice is kept per person for VOICE_HISTORY_KEEP_DAYS
// only; after that a day lives on as counts. product_days holds those counts
// (the product page's daily numbers), retention_weeks each signup week's
// return rates, frozen once its first month is over. A stay in voice stops
// keeping a city at all: its address key is enough to tell addresses apart.
//
// The rollback drops the counts; the per-person rows they replaced and the
// cities cleared here are gone for good.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('product_days', {
    day: { type: 'date', primaryKey: true },
    active_accounts: { type: 'integer', notNull: true, default: 0 },
    desktop_app: { type: 'integer', notNull: true, default: 0 },
    browser: { type: 'integer', notNull: true, default: 0 },
    mobile: { type: 'integer', notNull: true, default: 0 },
    voice_account_hours: { type: 'double precision', notNull: true, default: 0 },
    voice_guest_hours: { type: 'double precision', notNull: true, default: 0 },
    voice_joins: { type: 'integer', notNull: true, default: 0 },
    voice_accounts: { type: 'integer', notNull: true, default: 0 }
  });
  pgm.createTable('retention_weeks', {
    week: { type: 'date', primaryKey: true },
    accounts: { type: 'integer', notNull: true },
    week1_pct: { type: 'integer', notNull: true },
    week2_pct: { type: 'integer', notNull: true },
    month1_pct: { type: 'integer', notNull: true }
  });
  pgm.sql('UPDATE voice_sessions SET location = NULL WHERE location IS NOT NULL');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('retention_weeks');
  pgm.dropTable('product_days');
}
