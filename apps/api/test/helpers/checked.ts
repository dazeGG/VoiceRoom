// Values a test reads from outside its own code (an HTTP or WebSocket body,
// a database row, a JSON file) are checked against a schema before the test
// reads their fields, so a test never trusts a shape it did not verify.

import assert from 'node:assert/strict';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { firstMismatch } from '@voice-room/shared/contracts/http';
import type pg from 'pg';

/** The value, typed by `schema`, or a failed assertion naming the first mismatch. */
export function checked<const Schema extends TSchema>(schema: Schema, value: unknown, what = 'value'): Static<Schema> {
  if (Value.Check(schema, value)) return value;
  throw new assert.AssertionError({
    message: `${what} does not match its schema (${firstMismatch(schema, value)})`,
    actual: value
  });
}

/** A timestamp column, which pg reads as a Date. */
export const DateColumn = Type.Unsafe<Date>(Type.Refine(Type.Unknown(), (value) => value instanceof Date));

/** The rows of a query, each checked against `row`. */
export async function queryRows<const Row extends TSchema>(
  db: Pick<pg.Pool, 'query'>,
  row: Row,
  text: string,
  values: unknown[] = []
): Promise<Static<Row>[]> {
  const result = await db.query<Record<string, unknown>>(text, values);
  return result.rows.map((item, index) => checked(row, item, `row ${index} of "${text}"`));
}

/** The first row of a query, checked against `row`; fails when there is none. */
export async function queryRow<const Row extends TSchema>(
  db: Pick<pg.Pool, 'query'>,
  row: Row,
  text: string,
  values: unknown[] = []
): Promise<Static<Row>> {
  const [first] = await queryRows(db, row, text, values);
  if (first === undefined) throw new assert.AssertionError({ message: `"${text}" returned no row` });
  return first;
}

/** A row read whole (compared or serialized as it is), its columns unchecked. */
export const AnyRow = Type.Record(Type.String(), Type.Unknown());

/** The row of `SELECT count(*)::int AS count ...`. */
export const CountRow = Type.Object({ count: Type.Integer() });
