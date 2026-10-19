// A value handed over as a type it does not fully have: a wrong value for a
// test proving that a runtime guard rejects what a JavaScript caller or a
// malformed payload could still pass, or a partial double of a library type
// (a Fastify request) whose nested members no double can meet. Like `fake`,
// the overload is the one act of trust; the value is passed on unchanged.

export function mistyped<T>(value: unknown): T;
export function mistyped(value: unknown): unknown {
  return value;
}
