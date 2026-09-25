// Typed test doubles. A double implements only what its test drives; `fake`
// gives that partial object the full type, so the methods it does implement
// take their parameter types from the real interface and a signature that
// drifts from production fails to compile.

import type pg from 'pg';
import type { Logger } from 'pino';
import type { Attachment } from '../../src/domains/media/attachment-repository.ts';
import type { MediaJob } from '../../src/domains/media/media-job-repository.ts';
import type { NotificationOutboxEvent } from '../../src/domains/notifications/notification-outbox-repository.ts';

export function fake<T>(implementation: Partial<T> = {}): T {
  return implementation as T;
}

/**
 * A double whose every method records its name in `calls` and resolves to
 * undefined: for tests asserting that a dependency is never (or only) used.
 */
export function spy<T extends object>(calls: string[]): T {
  return new Proxy({} as T, {
    get: (_target, property) =>
      typeof property === 'string'
        ? (..._args: unknown[]) => {
            calls.push(property);
            return Promise.resolve(undefined);
          }
        : undefined
  });
}

/** A pg query result with just the fields code reads (rows, rowCount). */

export function result<Row extends pg.QueryResultRow>(
  rows: Row[] = [],
  rowCount: number = rows.length
): pg.QueryResult<Row> {
  return { rows, rowCount, command: '', oid: 0, fields: [] };
}

export type SqlCall = { text: string; values: unknown[] };

/**
 * A pool or client whose query() is answered by `answer`; every call is
 * recorded in `calls`. connect() hands out the same object as the client.
 * It is typed as a pg pool and client too, so code that takes either accepts it.
 */
export function fakeDb(answer: (text: string, values: unknown[]) => unknown = () => result()) {
  const calls: SqlCall[] = [];
  const db = {
    calls,
    released: 0,
    async query(text: string | { text: string }, values: unknown[] = []) {
      const sql = typeof text === 'string' ? text : text.text;
      calls.push({ text: sql, values });
      const answered = await answer(sql, values);
      return (answered ?? result()) as pg.QueryResult;
    },
    async connect() {
      return db;
    },
    release() {
      db.released += 1;
    },
    async end() {}
  };
  return db as typeof db & pg.Pool & pg.PoolClient;
}

export type ScopedCall = { scope: 'pool' | 'client'; text: string; values: unknown[] };

/**
 * A pool whose connect() hands out one transaction client; both share
 * `answer`, and every statement is recorded with the side it ran on (BEGIN,
 * COMMIT and ROLLBACK are answered by the client itself).
 */
export function fakePoolWithClient(answer: (text: string, values: unknown[], calls: ScopedCall[]) => unknown) {
  const calls: ScopedCall[] = [];
  const client = fakeDb((text, values) => {
    calls.push({ scope: 'client', text, values });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return result();
    return answer(text, values, calls);
  });
  client.release = () => {
    calls.push({ scope: 'client', text: 'release', values: [] });
  };
  const pool = {
    calls,
    async query(text: string, values: unknown[] = []) {
      calls.push({ scope: 'pool', text, values });
      return ((await answer(text, values, calls)) ?? result()) as pg.QueryResult;
    },
    async connect() {
      calls.push({ scope: 'pool', text: 'connect', values: [] });
      return client;
    },
    async end() {}
  };
  return pool as typeof pool & pg.Pool;
}

export function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'attachment-1',
    ownerId: 'owner',
    context: 'room',
    state: 'ready',
    internalState: 'ready',
    clientRequestId: null,
    reservedBytes: null,
    reservationExpiresAt: null,
    mimeType: 'image/webp',
    originalBytes: 20,
    processedBytes: 10,
    previewBytes: 5,
    width: 10,
    height: 10,
    storageKeys: { original: 'o', processed: 'p', preview: 'v' },
    roomMessageId: null,
    directMessageId: null,
    order: 0,
    failureCode: null,
    metadata: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    uploadedAt: null,
    readyAt: null,
    failedAt: null,
    boundAt: null,
    deletedAt: null,
    ...overrides
  };
}

export function mediaJob(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'job-1',
    attachmentId: 'attachment-1',
    kind: 'process',
    state: 'processing',
    attempts: 1,
    availableAt: new Date(),
    claimedBy: 'worker',
    claimedAt: new Date(),
    leaseExpiresAt: null,
    fencingToken: 1,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    deadAt: null,
    ...overrides
  };
}

export function outboxEvent(overrides: Partial<NotificationOutboxEvent> = {}): NotificationOutboxEvent {
  return {
    eventId: 'event-1',
    notificationId: 'notification-1',
    recipientUserId: 'recipient',
    revision: 1,
    channel: 'push',
    payload: {},
    status: 'processing',
    attempts: 1,
    createdAt: new Date(),
    ...overrides
  };
}

/**
 * A logger that records structured records by level. Typed as a pino Logger
 * so it can stand in wherever code takes one; only the level methods work.
 */
export function recordingLogger() {
  const records: Array<{ level: string; msg?: string } & Record<string, unknown>> = [];
  const at =
    (level: string) =>
    (fields: Record<string, unknown> | string = {}, msg?: string) => {
      records.push(typeof fields === 'string' ? { level, msg: fields } : { level, ...fields, msg });
    };
  const logger = {
    records,
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    log: at('info'),
    child: () => logger
  };
  return logger as typeof logger & Logger;
}
