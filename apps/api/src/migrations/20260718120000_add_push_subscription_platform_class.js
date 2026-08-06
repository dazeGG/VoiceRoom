'use strict';

exports.shorthands = undefined;

const PLATFORM_CLASS_TYPE = 'push_subscription_platform_class';
const PLATFORM_CLASS_COLUMN = 'platform_class';

exports.up = (pgm) => {
  pgm.sql(`SET LOCAL lock_timeout = '5s'`);

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${PLATFORM_CLASS_TYPE}') THEN
        CREATE TYPE ${PLATFORM_CLASS_TYPE} AS ENUM ('desktop', 'mobile', 'unknown');
      END IF;
    END
    $$;
  `);

  pgm.addColumn('push_subscriptions', {
    [PLATFORM_CLASS_COLUMN]: {
      type: PLATFORM_CLASS_TYPE,
      notNull: true,
      default: 'unknown'
    }
  });

  pgm.sql(`
    DO $$
    DECLARE
      updated_count integer := 0;
    BEGIN
      LOOP
        WITH batch AS (
          SELECT id, lower(coalesce(metadata->>'userAgent', '')) AS user_agent
          FROM push_subscriptions
          WHERE metadata ? 'userAgent'
          ORDER BY created_at, id
          LIMIT 1000
          FOR UPDATE SKIP LOCKED
        ),
        classified AS (
          SELECT
            id,
            CASE
              WHEN user_agent ~ '(android|iphone|ipod|windows phone|mobile|ipad)' THEN 'mobile'::${PLATFORM_CLASS_TYPE}
              WHEN user_agent ~ '(windows|macintosh|cros|x11|linux)' THEN 'desktop'::${PLATFORM_CLASS_TYPE}
              ELSE 'unknown'::${PLATFORM_CLASS_TYPE}
            END AS platform_class
          FROM batch
        )
        UPDATE push_subscriptions AS subscription
        SET platform_class = classified.platform_class,
            metadata = subscription.metadata - 'userAgent'
        FROM classified
        WHERE subscription.id = classified.id;

        GET DIAGNOSTICS updated_count = ROW_COUNT;
        EXIT WHEN updated_count = 0;
      END LOOP;
    END
    $$;
  `);

  pgm.createIndex('push_subscriptions', [PLATFORM_CLASS_COLUMN], {
    name: 'push_subscriptions_platform_class_idx'
  });
};

exports.down = (pgm) => {
  pgm.sql(`SET LOCAL lock_timeout = '5s'`);
  pgm.dropIndex('push_subscriptions', [PLATFORM_CLASS_COLUMN], {
    name: 'push_subscriptions_platform_class_idx',
    ifExists: true
  });
  pgm.dropColumn('push_subscriptions', PLATFORM_CLASS_COLUMN, { ifExists: true });
  pgm.sql(`DROP TYPE IF EXISTS ${PLATFORM_CLASS_TYPE}`);
};
