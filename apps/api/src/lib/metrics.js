'use strict';

const httpRequests = new Map();
const maintenanceTasks = new Map();
let pgPoolErrors = 0;
let mediaPressure = { freeBytes: 0, healthy: false, reason: 'unchecked' };
let notificationOldestPendingSeconds = 0;
let mediaOldestPendingSeconds = 0;
let mediaAuthorizationDenialFailures = 0;
let credentialRevokeCleanupFailures = 0;

function labelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}="${labelValue(value)}"`)
    .join(',');
}

function metricLine(name, labelSet, value) {
  return `${name}{${labels(labelSet)}} ${Number.isFinite(value) ? value : 0}`;
}

function httpKey({ method, route, statusCode }) {
  return `${method} ${route} ${statusCode}`;
}

function recordHttpRequest({ method = 'GET', route = 'unknown', statusCode = 0, durationMs = 0 } = {}) {
  const status = String(statusCode || 0);
  const key = httpKey({ method, route, statusCode: status });
  const current = httpRequests.get(key) || {
    method,
    route,
    status,
    count: 0,
    durationSecondsSum: 0
  };
  current.count += 1;
  current.durationSecondsSum += Math.max(0, Number(durationMs) || 0) / 1000;
  httpRequests.set(key, current);
}

function recordMaintenanceDuration(task, durationMs) {
  const name = String(task || 'unknown');
  const current = maintenanceTasks.get(name) || {
    task: name,
    count: 0,
    durationSecondsSum: 0,
    lastDurationSeconds: 0
  };
  const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
  current.count += 1;
  current.durationSecondsSum += seconds;
  current.lastDurationSeconds = seconds;
  maintenanceTasks.set(name, current);
}

function recordPgPoolError() {
  pgPoolErrors += 1;
}

function recordMediaPressure(snapshot = {}) {
  mediaPressure = {
    freeBytes: Math.max(0, Number(snapshot.freeBytes) || 0),
    healthy: snapshot.healthy === true,
    reason: String(snapshot.reason || 'unknown')
  };
}

function recordNotificationOldestPending(ageMs) { notificationOldestPendingSeconds = Math.max(0, Number(ageMs) || 0) / 1000; }
function recordMediaOldestPending(ageMs) { mediaOldestPendingSeconds = Math.max(0, Number(ageMs) || 0) / 1000; }
function recordMediaAuthorizationDenialFailure() { mediaAuthorizationDenialFailures += 1; }
function recordCredentialRevokeCleanupFailure() { credentialRevokeCleanupFailures += 1; }

async function observeMaintenance(task, callback) {
  const startedAt = process.hrtime.bigint();
  try {
    return await callback();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordMaintenanceDuration(task, durationMs);
  }
}

function renderPrometheus({
  activeWs = 0,
  activeGuestWs = 0,
  presenceRooms = 0,
  presencePeers = 0,
  capabilityReadiness = {}
} = {}) {
  const lines = [
    '# HELP voice_room_api_http_requests_total Total HTTP requests handled by the API.',
    '# TYPE voice_room_api_http_requests_total counter'
  ];

  for (const item of httpRequests.values()) {
    lines.push(metricLine('voice_room_api_http_requests_total', {
      method: item.method,
      route: item.route,
      status: item.status
    }, item.count));
  }

  lines.push(
    '# HELP voice_room_api_http_request_duration_seconds_sum Cumulative HTTP request duration by method, route and status.',
    '# TYPE voice_room_api_http_request_duration_seconds_sum counter'
  );
  for (const item of httpRequests.values()) {
    lines.push(metricLine('voice_room_api_http_request_duration_seconds_sum', {
      method: item.method,
      route: item.route,
      status: item.status
    }, item.durationSecondsSum));
  }

  lines.push(
    '# HELP voice_room_api_ws_connections Active realtime WebSocket connections.',
    '# TYPE voice_room_api_ws_connections gauge',
    `voice_room_api_ws_connections ${Math.max(0, Number(activeWs) || 0)}`,
    '# HELP voice_room_api_ws_guest_connections Active guest realtime WebSocket connections.',
    '# TYPE voice_room_api_ws_guest_connections gauge',
    `voice_room_api_ws_guest_connections ${Math.max(0, Number(activeGuestWs) || 0)}`,
    '# HELP voice_room_api_presence_rooms Active in-memory presence rooms.',
    '# TYPE voice_room_api_presence_rooms gauge',
    `voice_room_api_presence_rooms ${Math.max(0, Number(presenceRooms) || 0)}`,
    '# HELP voice_room_api_presence_peers Active in-memory presence peers.',
    '# TYPE voice_room_api_presence_peers gauge',
    `voice_room_api_presence_peers ${Math.max(0, Number(presencePeers) || 0)}`,
    '# HELP voice_room_api_pg_pool_errors_total Unexpected PostgreSQL pool errors.',
    '# TYPE voice_room_api_pg_pool_errors_total counter',
    `voice_room_api_pg_pool_errors_total ${pgPoolErrors}`,
    '# HELP voice_room_api_media_free_bytes Available bytes in private media storage.',
    '# TYPE voice_room_api_media_free_bytes gauge',
    `voice_room_api_media_free_bytes ${mediaPressure.freeBytes}`,
    '# HELP voice_room_api_media_pressure_healthy Whether media uploads and claims are pressure-safe.',
    '# TYPE voice_room_api_media_pressure_healthy gauge',
    metricLine('voice_room_api_media_pressure_healthy', { reason: mediaPressure.reason }, Number(mediaPressure.healthy)),
    '# HELP voice_room_notification_oldest_pending_seconds Age of the oldest claimed notification job.',
    '# TYPE voice_room_notification_oldest_pending_seconds gauge',
    `voice_room_notification_oldest_pending_seconds ${notificationOldestPendingSeconds}`,
    '# HELP voice_room_media_oldest_pending_seconds Age of the oldest claimed media job.',
    '# TYPE voice_room_media_oldest_pending_seconds gauge',
    `voice_room_media_oldest_pending_seconds ${mediaOldestPendingSeconds}`,
    '# HELP voice_room_media_authorization_denial_failures_total Media reads denied by the authorization boundary.',
    '# TYPE voice_room_media_authorization_denial_failures_total counter',
    `voice_room_media_authorization_denial_failures_total ${mediaAuthorizationDenialFailures}`,
    '# HELP voice_room_credential_revoke_cleanup_failures_total Admission credential cleanup failures.',
    '# TYPE voice_room_credential_revoke_cleanup_failures_total counter',
    `voice_room_credential_revoke_cleanup_failures_total ${credentialRevokeCleanupFailures}`,
    '# HELP voice_room_api_maintenance_duration_seconds_sum Cumulative maintenance task duration.',
    '# TYPE voice_room_api_maintenance_duration_seconds_sum counter'
  );

  for (const item of maintenanceTasks.values()) {
    lines.push(metricLine('voice_room_api_maintenance_duration_seconds_sum', { task: item.task }, item.durationSecondsSum));
  }

  lines.push(
    '# HELP voice_room_api_maintenance_duration_seconds_count Maintenance task run count.',
    '# TYPE voice_room_api_maintenance_duration_seconds_count counter'
  );
  for (const item of maintenanceTasks.values()) {
    lines.push(metricLine('voice_room_api_maintenance_duration_seconds_count', { task: item.task }, item.count));
  }

  lines.push(
    '# HELP voice_room_api_maintenance_last_duration_seconds Last maintenance task duration.',
    '# TYPE voice_room_api_maintenance_last_duration_seconds gauge'
  );
  for (const item of maintenanceTasks.values()) {
    lines.push(metricLine('voice_room_api_maintenance_last_duration_seconds', { task: item.task }, item.lastDurationSeconds));
  }

  for (const [key, value] of Object.entries(capabilityReadiness)) {
    if (typeof value !== 'boolean') continue;
    lines.push(metricLine('voice_room_api_capability_ready', { key }, Number(value)));
  }

  return `${lines.join('\n')}\n`;
}

function resetMetricsForTest() {
  httpRequests.clear();
  maintenanceTasks.clear();
  pgPoolErrors = 0;
  mediaPressure = { freeBytes: 0, healthy: false, reason: 'unchecked' };
  notificationOldestPendingSeconds = 0;
  mediaOldestPendingSeconds = 0;
  mediaAuthorizationDenialFailures = 0;
  credentialRevokeCleanupFailures = 0;
}

module.exports = {
  observeMaintenance,
  recordHttpRequest,
  recordMaintenanceDuration,
  recordMediaPressure,
  recordNotificationOldestPending,
  recordMediaOldestPending,
  recordMediaAuthorizationDenialFailure,
  recordCredentialRevokeCleanupFailure,
  recordPgPoolError,
  renderPrometheus,
  resetMetricsForTest
};
