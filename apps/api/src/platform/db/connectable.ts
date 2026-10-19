// Repositories take "a pool or a client"; only a pool can hand out the client a
// transaction or a lock needs, and test doubles often bring just `query`.

import type pg from 'pg';

export type Connectable = { connect: () => Promise<pg.PoolClient> };

/** True when `pool` can hand out a client of its own. */
export function canConnect<T extends object>(pool: T | null | undefined): pool is T & Connectable {
  return typeof pool === 'object' && pool !== null && 'connect' in pool && typeof pool.connect === 'function';
}
