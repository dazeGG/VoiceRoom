'use strict';

// The single source of truth for the `evt` field carried by every structured
// log record. Grepping or alerting on a stable code is what makes an incident
// searchable months later, so codes are added here rather than inlined at the
// call site, and they are never renamed once shipped — a renamed code silently
// breaks every dashboard and alert built on it.
//
// Naming: `<domain>.<past_tense_or_noun>`, lower snake case after the dot.
const LOG_EVENTS = Object.freeze({
  // Process lifecycle.
  BOOTSTRAP_FAILED: 'boot.failed',
  SHUTDOWN_STARTED: 'boot.shutdown_started',
  SHUTDOWN_TIMEOUT: 'boot.shutdown_timeout',
  SHUTDOWN_FAILED: 'boot.shutdown_failed',
  LISTENING: 'boot.listening',
  LISTEN_FALLBACK: 'boot.listen_fallback',
  STORE_CLOSE_FAILED: 'boot.store_close_failed',

  // Background workers.
  WORKER_STARTED: 'worker.started',
  WORKER_DISABLED: 'worker.disabled',
  WORKER_FAILED: 'worker.failed',
  WORKER_HEARTBEAT_FAILED: 'worker.heartbeat_failed',

  // HTTP edge.
  HTTP_REQUEST: 'http.request',
  HTTP_HANDLER_FAILED: 'http.handler_failed',

  // Accounts and sessions.
  AUTH_SIGN_IN_RECORD_FAILED: 'auth.sign_in_record_failed',
  ACCOUNT_DELETION_FAILED: 'account.deletion_failed',
  ACCOUNT_SESSION_VOICE_END_FAILED: 'account.session_voice_end_failed',

  // Realtime transport.
  WS_CONNECTED: 'ws.connected',
  WS_CLOSED: 'ws.closed',
  WS_REJECTED_OVER_LIMIT: 'ws.rejected_over_limit',
  WS_MESSAGE_FAILED: 'ws.message_failed',
  WS_MESSAGE_REJECTED: 'ws.message_rejected',
  WS_FRIENDS_LOAD_FAILED: 'ws.friends_load_failed',
  WS_PRESENCE_FRIENDS_LOAD_FAILED: 'ws.presence_friends_load_failed',
  WS_SUMMARY_LOAD_FAILED: 'ws.summary_load_failed',

  // Voice rooms.
  ROOM_JOINED: 'room.joined',
  ROOM_JOIN_REJECTED: 'room.join_rejected',
  ROOM_LEFT: 'room.left',
  ROOM_OCCUPANCY_PERSIST_FAILED: 'room.occupancy_persist_failed',
  ROOM_OCCUPANCY_RETRY_FAILED: 'room.occupancy_retry_failed',
  ROOM_TYPING_FORWARD_FAILED: 'room.typing_forward_failed',
  ROOM_SUMMARY_RECIPIENTS_FAILED: 'room.summary_recipients_failed',
  ROOM_INVITATION_EXPIRY_FAILED: 'room.invitation_expiry_failed',

  // LiveKit admission boundary.
  LIVEKIT_ADMISSION_DENIED: 'livekit.admission_denied',
  LIVEKIT_ADMISSION_REVOKED: 'livekit.admission_revoked',
  LIVEKIT_MUTE_FAILED: 'livekit.mute_failed',
  LIVEKIT_PARTICIPANT_REMOVE_FAILED: 'livekit.participant_remove_failed',
  LIVEKIT_GATE_UPSTREAM_FAILED: 'livekit.gate_upstream_failed',
  LIVEKIT_GATE_AUTHORIZATION_FAILED: 'livekit.gate_authorization_failed',
  LIVEKIT_GATE_DENIED: 'livekit.gate_denied',

  // Messaging and delivery.
  MESSAGE_EVENT_DISPATCH_FAILED: 'msg.event_dispatch_failed',
  MESSAGE_LISTENER_FAILED: 'msg.listener_failed',
  MESSAGE_DELIVERY_FAILED: 'msg.delivery_failed',
  MESSAGE_PIN_REFRESH_FAILED: 'msg.pin_refresh_failed',
  MESSAGE_AUTHOR_PROFILE_FAILED: 'msg.author_profile_failed',

  // Notifications and push.
  NOTIFICATION_DELIVERY_FAILED: 'notify.delivery_failed',
  NOTIFICATION_BACKLOG_AGED: 'notify.backlog_aged',
  NOTIFICATION_RETIRE_FAILED: 'notify.retire_failed',
  NOTIFICATION_BROADCAST_FAILED: 'notify.broadcast_failed',
  PUSH_SEND_FAILED: 'push.send_failed',
  PUSH_SUBSCRIPTION_LOAD_FAILED: 'push.subscription_load_failed',
  PUSH_SUBSCRIPTION_PRUNE_FAILED: 'push.subscription_prune_failed',

  // Media and link previews.
  MEDIA_JOB_FAILED: 'media.job_failed',
  LINK_PREVIEW_FAILED: 'media.link_preview_failed',
  LINK_PREVIEW_RECONCILE_FAILED: 'media.link_preview_reconcile_failed',

  // Storage and maintenance.
  DB_POOL_ERROR: 'db.pool_error',
  MAINTENANCE_TASK_FAILED: 'maintenance.task_failed',
  MAINTENANCE_TASK_COMPLETED: 'maintenance.task_completed',
  MIGRATION_DIRTY_CLEARED: 'migration.dirty_cleared',
  MIGRATION_COMPLETED: 'migration.completed',
  SESSION_TOUCH_FAILED: 'session.touch_failed',
  GEOIP_UNAVAILABLE: 'geoip.unavailable',
  DESKTOP_RELEASE_FETCH_FAILED: 'desktop.release_fetch_failed',

  // Browser-sourced records relayed through POST /api/client-logs.
  CLIENT_REPORT: 'client.report',
  CLIENT_REPORT_REJECTED: 'client.report_rejected'
});

const LOG_EVENT_CODES = Object.freeze(Object.values(LOG_EVENTS));

module.exports = { LOG_EVENTS, LOG_EVENT_CODES };
