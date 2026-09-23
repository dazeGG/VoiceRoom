// The dependencies every route module receives explicitly, instead of reaching
// for server.js's module-level singletons (docs/ARCHITECTURE.md, section 2).
// It holds only what is shared across route groups; services that belong to
// one group are passed to that group's register function next to it, and the
// context grows as groups move out of server.js.

import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';

export interface SessionUser {
  id: string;
  [key: string]: unknown;
}

export interface ApiContext {
  logger: Logger;
  /** The client address, honouring TRUST_PROXY exactly like the legacy handlers. */
  clientIp(req: IncomingMessage): string;
  /** The signed-in user behind the request's session cookie, if any. */
  resolveSession(req: IncomingMessage): Promise<{ user?: SessionUser | null } | null>;
  hashIp(ip: string): string;
}
