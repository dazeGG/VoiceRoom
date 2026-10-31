// A deep copy of plain data out of Vue state. `toRaw` unwraps only the top level, so a
// reactive proxy kept inside a message makes `structuredClone` throw a DataCloneError.

import { toRaw } from 'vue';
import { isArray, isRecord } from '@voice-room/shared/guards';

// Only plain objects are rebuilt; a Date, Map or other instance goes to `structuredClone` as it is.
const PLAIN_PROTOTYPES: ReadonlySet<object | null> = new Set([null, Reflect.getPrototypeOf({})]);

function unwrap(value: unknown): unknown {
  const raw: unknown = toRaw(value);
  if (isArray(raw)) return raw.map(unwrap);
  if (!isRecord(raw) || !PLAIN_PROTOTYPES.has(Reflect.getPrototypeOf(raw))) return raw;
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, unwrap(entry)]));
}

// Unwrapping only replaces proxies by their targets, so the copy has the kind of the original.
function isCopyOf<T>(copy: unknown, original: T): copy is T {
  return typeof copy === typeof original && Array.isArray(copy) === Array.isArray(original);
}

/** The value with every reactive proxy inside it unwrapped, as a new object tree. */
export function deepRaw<T>(value: T): T {
  const copy = unwrap(value);
  if (!isCopyOf(copy, value)) throw new TypeError('unwrapping changed the kind of the value');
  return copy;
}

/** An independent plain copy of `value`, safe to keep while the original changes. */
export function plainSnapshot<T>(value: T): T {
  return structuredClone(deepRaw(value));
}
