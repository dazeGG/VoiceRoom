'use strict';

exports.shorthands = undefined;

// Accounts created before this point skip the one-time post-registration app
// prompt; they still get the in-room banner. A fixed cutoff keeps a repeated
// `up` from marking accounts that registered after the release.
const APP_PROMPT_CUTOFF = '2026-09-16T15:00:00Z';

exports.up = (pgm) => {
  // `desktopAppSeenAt` records the first sign-in from the desktop app. Sessions
  // disappear on logout, expiry and password change, so this is the durable
  // copy; it is rebuilt from what sessions and login events still show. The
  // pattern matches CLIENT_RULES[0] in packages/shared/src/account-security.js.
  pgm.sql(`
    WITH desktop AS (
      SELECT user_id, min(created_at) AS first_seen
      FROM (
        SELECT user_id, created_at FROM sessions WHERE user_agent ~* 'VoiceRoom|Electron/'
        UNION ALL
        SELECT user_id, created_at FROM account_login_events WHERE client = 'VoiceRoom Desktop'
      ) sources
      GROUP BY user_id
    )
    UPDATE users u
    SET metadata = jsonb_set(u.metadata, '{desktopAppSeenAt}', to_jsonb((extract(epoch FROM d.first_seen) * 1000)::bigint), true)
    FROM desktop d
    WHERE u.id = d.user_id
      AND NOT (u.metadata ? 'desktopAppSeenAt')
  `);
  pgm.sql(`
    UPDATE users
    SET metadata = jsonb_set(metadata, '{appPromptSeenAt}', to_jsonb((extract(epoch FROM TIMESTAMPTZ '${APP_PROMPT_CUTOFF}') * 1000)::bigint), true)
    WHERE created_at < TIMESTAMPTZ '${APP_PROMPT_CUTOFF}'
      AND NOT (metadata ? 'appPromptSeenAt')
  `);
};

// Rolling back drops markers stamped after deploy; a later `up` can only rebuild
// the ones sessions and login events still show. Production never runs down
// migrations (docs/operations/PREDEPLOY_MIGRATIONS.md).
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE users
    SET metadata = metadata - 'desktopAppSeenAt' - 'appPromptSeenAt'
    WHERE metadata ?| array['desktopAppSeenAt', 'appPromptSeenAt']
  `);
};
