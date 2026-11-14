import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { runMigrations } from '../src/lib/migrate.ts';
import { queryRow } from './helpers/checked.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';
const skip = !process.env.TEST_DATABASE_URL;
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test(
  'target locale migration backfills, constrains and rolls back without losing registrations',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await rollBackThrough(databaseUrl, '20261114000000_add_target_localization');
    await pool.query("INSERT INTO users (id,login,password_hash) VALUES ('a','aaa','x')");
    await pool.query("INSERT INTO sessions (id,user_id,expires_at) VALUES ('s','a',now()+interval '1 day')");
    await pool.query(
      "INSERT INTO device_tokens (id,user_id,session_id,provider,token) VALUES ('d','a','s','rustore','test')"
    );
    await pool.query(
      `INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,metadata) VALUES ('p','a','https://push.example/x','p','a','{"keep":true}')`
    );
    await runMigrations({ databaseUrl, logger: SILENT });
    const native = await queryRow(
      pool,
      Type.Object({ locale: Type.String(), registration_version: Type.String() }),
      'SELECT locale, registration_version::text FROM device_tokens'
    );
    assert.equal(native.locale, 'ru');
    assert.match(native.registration_version, /^[0-9a-f-]{36}$/);
    const web = await queryRow(
      pool,
      Type.Object({
        metadata: Type.Object({ keep: Type.Boolean(), locale: Type.String(), registrationVersion: Type.String() })
      }),
      'SELECT metadata FROM push_subscriptions'
    );
    assert.equal(web.metadata.keep, true);
    assert.equal(web.metadata.locale, 'ru');
    await assert.rejects(pool.query("UPDATE device_tokens SET locale='de'"));
    await rollBackThrough(databaseUrl, '20261114000000_add_target_localization');
    assert.equal(
      (await queryRow(pool, Type.Object({ count: Type.Integer() }), 'SELECT count(*)::int AS count FROM device_tokens'))
        .count,
      1
    );
    assert.deepEqual(
      (
        await queryRow(
          pool,
          Type.Object({ metadata: Type.Record(Type.String(), Type.Unknown()) }),
          'SELECT metadata FROM push_subscriptions'
        )
      ).metadata,
      { keep: true }
    );
  }
);
