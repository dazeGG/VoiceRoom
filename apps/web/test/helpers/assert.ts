// Narrowing checks for tests (unit and e2e): each one fails the test with a
// readable message instead of letting a cast or `!` hide a missing value.

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { firstMismatch } from '@voice-room/shared/contracts/http';

/** `value`, or a thrown error naming `what` when it is null or undefined. */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}

/** `value` as an instance of `type` (a DOM element class, a fake class), or a thrown error. */
export function instanceOf<T>(value: unknown, type: abstract new (...args: never[]) => T, what: string): T {
  if (!(value instanceof type)) throw new Error(`${what} is not a ${type.name}`);
  return value;
}

/** JSON text parsed as `unknown` (JSON.parse types it as any), to check before use. */
export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

/** `value` checked against a contract schema, e.g. a request body a test captured. */
export function parse<Schema extends TSchema>(schema: Schema, value: unknown): Static<Schema> {
  if (!Value.Check(schema, value)) throw new Error(`unexpected shape: ${firstMismatch(schema, value)}`);
  return value;
}
