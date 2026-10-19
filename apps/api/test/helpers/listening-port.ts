import assert from 'node:assert/strict';
import type { Server } from 'node:net';

/** The TCP port a listening server took; fails when it listens on a pipe or not at all. */
export function listeningPort(server: Pick<Server, 'address'>): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new assert.AssertionError({ message: `expected a TCP address, got ${String(address)}`, actual: address });
  }
  return address.port;
}
