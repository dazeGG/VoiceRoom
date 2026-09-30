// The envelope every HTTP route answers with. A success is `{ ok: true, ... }`
// with the route's own fields; a failure is `Failure`. The API registers these
// schemas with Fastify (they validate input and shape output), the web reads
// the same types, so a field one side drops is a type error on the other.

import { Type, type Static, type TProperties, type TSchema } from 'typebox';

/**
 * `code` is one of ERROR_CODES (./errors.ts); the web picks the user's text
 * from it. `error` is the server's own wording, for logs and old clients.
 */
export const Failure = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  code: Type.String(),
  retryAfterSeconds: Type.Optional(Type.Number())
});
export type Failure = Static<typeof Failure>;

/** A success body: `ok: true` plus the route's fields. */
export function Ok<const Properties extends TProperties>(properties: Properties) {
  return Type.Object({ ok: Type.Literal(true), ...properties });
}

/** A success body with nothing else in it. */
export const Done = Ok({});
export type Done = Static<typeof Done>;

/** Responses for a route that answers 200 with `success` or a 4xx failure. */
export function Responses<Success extends ReturnType<typeof Ok>>(success: Success) {
  return { 200: success, '4xx': Failure } as const;
}

export const Nullable = <Schema extends TSchema>(schema: Schema) => Type.Union([schema, Type.Null()]);

export const IdParams = Type.Object({ id: Type.String() });
export const UserIdParams = Type.Object({ userId: Type.String() });
export const RoomIdParams = Type.Object({ roomId: Type.String() });
