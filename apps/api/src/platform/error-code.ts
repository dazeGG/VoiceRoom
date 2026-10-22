// The `code` a thrown value carries, if any: pg's SQLSTATE, Node's errno
// name (`ENOENT`), or a domain error's own code.

import { fieldOf } from './record.ts';

export function codeOf(error: unknown): unknown {
  return fieldOf(error, 'code');
}
