// The service's own account, @voiceroom: people write to it, staff answer
// from the admin app. It has a fixed id (OFFICIAL_ACCOUNT_ID in
// @voiceroom/shared/official-account), the `official` badge and the password
// hash no password matches (UNUSABLE_PASSWORD_HASH), so nobody signs in as it.
// Its avatar file is written by the API at start (startup-tasks.ts), since
// the migration runs where the uploads volume is not mounted.
//
// The login has been reserved only since 2026-10-16, so an older account may
// hold it. Up then stops with a message naming that account instead of a bare
// unique violation, and never goes on without the official account. Logins
// are stored lower-case (normalizeLogin); the check ignores case anyway.
// Prod and dev were checked read-only on 2026-11-28: the login is free on both.
//
// Down runs on dev and test only. It removes the account only while no direct
// message involves it; otherwise the account and its conversations stay.
// Every other table that points at users cascades or sets null (allow lists,
// pair state, mutes, notifications, push targets), so the delete never hits a
// foreign key.

import type { MigrationBuilder } from 'node-pg-migrate';

const ID = '00000000-0000-4000-8000-00000000f00d';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    DO $$
    DECLARE taken varchar;
    BEGIN
      SELECT id INTO taken FROM users WHERE lower(login) = 'voiceroom' AND id <> '${ID}' LIMIT 1;
      IF taken IS NOT NULL THEN
        RAISE EXCEPTION 'The login voiceroom is taken by account %; rename it before creating the official account', taken;
      END IF;
    END $$;
    INSERT INTO users (id, login, display_name, password_hash, badge, avatar_color_key)
    VALUES ('${ID}', 'voiceroom', 'VoiceRoom', '!', 'official', 'olive')
    ON CONFLICT (id) DO NOTHING;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    DELETE FROM users
    WHERE id = '${ID}'
      AND NOT EXISTS (SELECT 1 FROM direct_messages WHERE sender_id = '${ID}' OR recipient_id = '${ID}');
  `);
}
