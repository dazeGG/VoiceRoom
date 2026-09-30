'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    WITH classified AS (
      SELECT id, metadata,
        CASE
          WHEN metadata->>'platformClass' IN ('desktop', 'mobile', 'unknown') THEN (metadata->>'platformClass')::push_subscription_platform_class
          WHEN metadata @> '{"desktopBridge": true}'::jsonb THEN 'desktop'::push_subscription_platform_class
          WHEN jsonb_typeof(metadata->'userAgentDataMobile') = 'boolean' THEN CASE WHEN (metadata->>'userAgentDataMobile')::boolean THEN 'mobile' ELSE 'desktop' END::push_subscription_platform_class
          WHEN jsonb_typeof(metadata->'userAgentData'->'mobile') = 'boolean' THEN CASE WHEN (metadata->'userAgentData'->>'mobile')::boolean THEN 'mobile' ELSE 'desktop' END::push_subscription_platform_class
          WHEN coalesce(metadata->>'platform', '') ~* '^MacIntel$' AND CASE WHEN coalesce(metadata->>'maxTouchPoints', '') ~ '^\d+(\.\d+)?$' THEN (metadata->>'maxTouchPoints')::numeric ELSE 0 END > 1 THEN 'mobile'::push_subscription_platform_class
          WHEN coalesce(metadata->>'platform', '') ~* '^(win|mac|linux)' THEN 'desktop'::push_subscription_platform_class
          ELSE platform_class
        END AS corrected
      FROM push_subscriptions
      WHERE metadata ?| ARRAY['desktopBridge','maxTouchPoints','platform','platformClass','userAgentData','userAgentDataMobile']
    )
    UPDATE push_subscriptions subscription
    SET platform_class = classified.corrected,
        metadata = subscription.metadata - ARRAY['desktopBridge','maxTouchPoints','platform','platformClass','userAgentData','userAgentDataMobile']
    FROM classified WHERE subscription.id = classified.id
  `);
};

// Forward-only data hygiene: removed raw classification signals cannot be
// reconstructed. Application rollback remains compatible with the column.
exports.down = (pgm) => { pgm.sql("SET LOCAL lock_timeout = '5s'"); };
