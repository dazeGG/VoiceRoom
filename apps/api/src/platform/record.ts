// One field of a value that came from outside (whatever was thrown, a
// library's loosely typed object), read as `unknown` and narrowed where used.

import { isRecord } from '@voice-room/shared/guards';

/** The field, or undefined when the value is not an object. */
export function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export { isRecord };
