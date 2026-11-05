type HttpRequestStat = { method: string; route: string; status: string; count: number; durationSecondsSum: number };
type MaintenanceStat = { task: string; count: number; durationSecondsSum: number; lastDurationSeconds: number };
export type MediaPressureSnapshot = { freeBytes?: unknown; healthy?: unknown; reason?: unknown };

const httpRequests = new Map<string, HttpRequestStat>();
// Totals say only the average; a handful of slow answers hide in it.
const LATENCY_BUCKETS_SECONDS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
type Histogram = { labels: Record<string, string>; buckets: number[]; count: number; sum: number };
const httpLatency = new Map<string, Histogram>();
// In milliseconds, as the browser reports them (CLS, which has no unit, in thousandths).
const WEB_VITAL_BUCKETS = [50, 100, 200, 400, 800, 1200, 1800, 2500, 4000, 6000, 10000];
const webVitals = new Map<string, Histogram>();
const maintenanceTasks = new Map<string, MaintenanceStat>();
let pgPoolErrors = 0;
let mediaPressure: { freeBytes: number; healthy: boolean; reason: string } = {
  freeBytes: 0,
  healthy: false,
  reason: 'unchecked'
};
let notificationOldestPendingSeconds = 0;
let mediaOldestPendingSeconds = 0;
let mediaAuthorizationInvariantFailures = 0;
let credentialRevokeCleanupFailures = 0;

function labelValue(value: unknown): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}="${labelValue(value)}"`)
    .join(',');
}

function metricLine(name: string, labelSet: Record<string, unknown>, value: number): string {
  return `${name}{${labels(labelSet)}} ${Number.isFinite(value) ? value : 0}`;
}

function observe(
  histograms: Map<string, Histogram>,
  key: string,
  labelSet: Record<string, string>,
  bounds: readonly number[],
  value: number
): void {
  const histogram = histograms.get(key) ?? {
    labels: labelSet,
    buckets: bounds.map(() => 0),
    count: 0,
    sum: 0
  };
  bounds.forEach((bound, index) => {
    if (value <= bound) histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
  });
  histogram.count += 1;
  histogram.sum += value;
  histograms.set(key, histogram);
}

function histogramLines(
  name: string,
  help: string,
  histograms: Map<string, Histogram>,
  bounds: readonly number[]
): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (const { labels: labelSet, buckets, count, sum } of histograms.values()) {
    bounds.forEach((bound, index) => {
      lines.push(metricLine(`${name}_bucket`, { ...labelSet, le: bound }, buckets[index] ?? 0));
    });
    lines.push(metricLine(`${name}_bucket`, { ...labelSet, le: '+Inf' }, count));
    lines.push(metricLine(`${name}_sum`, labelSet, sum));
    lines.push(metricLine(`${name}_count`, labelSet, count));
  }
  return lines;
}

/** What one browser measured of a page; see /api/client-vitals. */
function recordWebVital(name: string, value: number): void {
  observe(webVitals, name, { name }, WEB_VITAL_BUCKETS, Math.max(0, value));
}

function httpKey({ method, route, statusCode }: { method: string; route: string; statusCode: string }): string {
  return `${method} ${route} ${statusCode}`;
}

function recordHttpRequest({
  method = 'GET',
  route = 'unknown',
  statusCode = 0,
  durationMs = 0
}: { method?: string; route?: string; statusCode?: number | string; durationMs?: number } = {}): void {
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
  const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
  current.durationSecondsSum += seconds;
  httpRequests.set(key, current);
  observe(httpLatency, `${method} ${route}`, { method, route }, LATENCY_BUCKETS_SECONDS, seconds);
}

function recordMaintenanceDuration(task: unknown, durationMs: unknown): void {
  const name = typeof task === 'string' && task ? task : 'unknown';
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

function recordPgPoolError(): void {
  pgPoolErrors += 1;
}

function recordMediaPressure(snapshot: MediaPressureSnapshot = {}): void {
  mediaPressure = {
    freeBytes: Math.max(0, Number(snapshot.freeBytes) || 0),
    healthy: snapshot.healthy === true,
    reason: typeof snapshot.reason === 'string' && snapshot.reason ? snapshot.reason : 'unknown'
  };
}

function recordNotificationOldestPending(ageMs: unknown): void {
  notificationOldestPendingSeconds = Math.max(0, Number(ageMs) || 0) / 1000;
}
function recordMediaOldestPending(ageMs: unknown): void {
  mediaOldestPendingSeconds = Math.max(0, Number(ageMs) || 0) / 1000;
}
function recordMediaAuthorizationInvariantFailure(): void {
  mediaAuthorizationInvariantFailures += 1;
}
function recordCredentialRevokeCleanupFailure(): void {
  credentialRevokeCleanupFailures += 1;
}

async function observeMaintenance<T>(task: string, callback: () => T | Promise<T>): Promise<T> {
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
  presencePeers = 0
}: {
  activeWs?: number;
  activeGuestWs?: number;
  presenceRooms?: number;
  presencePeers?: number;
} = {}): string {
  const lines = [
    '# HELP voice_room_api_http_requests_total Total HTTP requests handled by the API.',
    '# TYPE voice_room_api_http_requests_total counter'
  ];

  for (const item of httpRequests.values()) {
    lines.push(
      metricLine(
        'voice_room_api_http_requests_total',
        {
          method: item.method,
          route: item.route,
          status: item.status
        },
        item.count
      )
    );
  }

  lines.push(
    ...histogramLines(
      'voice_room_api_http_latency_seconds',
      'How long HTTP requests took by method and route.',
      httpLatency,
      LATENCY_BUCKETS_SECONDS
    ),
    ...histogramLines(
      'voice_room_web_vital',
      'What browsers measured of the pages they opened, in milliseconds (CLS in thousandths).',
      webVitals,
      WEB_VITAL_BUCKETS
    )
  );

  lines.push(
    '# HELP voice_room_api_http_request_duration_seconds_sum Cumulative HTTP request duration by method, route and status.',
    '# TYPE voice_room_api_http_request_duration_seconds_sum counter'
  );
  for (const item of httpRequests.values()) {
    lines.push(
      metricLine(
        'voice_room_api_http_request_duration_seconds_sum',
        {
          method: item.method,
          route: item.route,
          status: item.status
        },
        item.durationSecondsSum
      )
    );
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
    metricLine(
      'voice_room_api_media_pressure_healthy',
      { reason: mediaPressure.reason },
      Number(mediaPressure.healthy)
    ),
    '# HELP voice_room_notification_oldest_pending_seconds Age of the oldest claimed notification job.',
    '# TYPE voice_room_notification_oldest_pending_seconds gauge',
    `voice_room_notification_oldest_pending_seconds ${notificationOldestPendingSeconds}`,
    '# HELP voice_room_media_oldest_pending_seconds Age of the oldest claimed media job.',
    '# TYPE voice_room_media_oldest_pending_seconds gauge',
    `voice_room_media_oldest_pending_seconds ${mediaOldestPendingSeconds}`,
    '# HELP voice_room_media_authorization_invariant_failures_total Unexpected authorization/storage invariant failures; ordinary hidden 404 denials are excluded.',
    '# TYPE voice_room_media_authorization_invariant_failures_total counter',
    `voice_room_media_authorization_invariant_failures_total ${mediaAuthorizationInvariantFailures}`,
    '# HELP voice_room_credential_revoke_cleanup_failures_total Admission credential cleanup failures.',
    '# TYPE voice_room_credential_revoke_cleanup_failures_total counter',
    `voice_room_credential_revoke_cleanup_failures_total ${credentialRevokeCleanupFailures}`,
    '# HELP voice_room_api_maintenance_duration_seconds_sum Cumulative maintenance task duration.',
    '# TYPE voice_room_api_maintenance_duration_seconds_sum counter'
  );

  for (const item of maintenanceTasks.values()) {
    lines.push(
      metricLine('voice_room_api_maintenance_duration_seconds_sum', { task: item.task }, item.durationSecondsSum)
    );
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
    lines.push(
      metricLine('voice_room_api_maintenance_last_duration_seconds', { task: item.task }, item.lastDurationSeconds)
    );
  }

  return `${lines.join('\n')}\n`;
}

/** Every request answered since the process started: the system sampler turns it into per-minute numbers. */
function httpTotals(): { count: number; errors5xx: number; durationSecondsSum: number } {
  let count = 0;
  let errors5xx = 0;
  let durationSecondsSum = 0;
  for (const item of httpRequests.values()) {
    count += item.count;
    durationSecondsSum += item.durationSecondsSum;
    if (item.status.startsWith('5')) errors5xx += item.count;
  }
  return { count, errors5xx, durationSecondsSum };
}

function resetMetricsForTest(): void {
  httpLatency.clear();
  webVitals.clear();
  httpRequests.clear();
  maintenanceTasks.clear();
  pgPoolErrors = 0;
  mediaPressure = { freeBytes: 0, healthy: false, reason: 'unchecked' };
  notificationOldestPendingSeconds = 0;
  mediaOldestPendingSeconds = 0;
  mediaAuthorizationInvariantFailures = 0;
  credentialRevokeCleanupFailures = 0;
}

export {
  httpTotals,
  observeMaintenance,
  recordHttpRequest,
  recordMaintenanceDuration,
  recordMediaPressure,
  recordNotificationOldestPending,
  recordMediaOldestPending,
  recordMediaAuthorizationInvariantFailure,
  recordCredentialRevokeCleanupFailure,
  recordPgPoolError,
  recordWebVital,
  renderPrometheus,
  resetMetricsForTest
};
