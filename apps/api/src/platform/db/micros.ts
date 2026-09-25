// Message cursors name an instant in epoch microseconds. node-pg hands
// timestamps back as JS Dates, which keep only milliseconds, so cursor
// comparisons are made in SQL on the exact value.

import { sql } from 'kysely';

/** The instant `micros` microseconds after the epoch. */
export function fromMicros(micros: unknown) {
  return sql<Date>`TIMESTAMPTZ 'epoch' + ${String(micros)}::bigint * INTERVAL '1 microsecond'`;
}

/** A timestamp column as epoch microseconds, as text so no precision is lost. */
export function microsOf(column: string) {
  return sql<string>`floor(extract(epoch FROM ${sql.ref(column)}) * 1000000)::bigint::text`;
}
