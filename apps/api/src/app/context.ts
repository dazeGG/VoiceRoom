// The dependencies every route module receives explicitly, instead of reaching
// for server.ts's module-level singletons (docs/ARCHITECTURE.md, section 3).
// It holds only what is shared across route groups; services that belong to
// one group are passed to that group's register function next to it, and the
// context grows as groups move out of server.ts.

import type { IncomingMessage } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import type { StoredUser } from '../lib/user-store.ts';

/** The signed-in account behind a session, as the user store reads it. */
export type SessionUser = StoredUser;

/** The signed-in session itself, as the user store returns it. */
export interface SessionRecord {
  publicId: string;
  tokenHash: string;
  [key: string]: unknown;
}

export interface ResolvedSession {
  user?: SessionUser | null;
  session?: SessionRecord;
}

export interface ApiContext {
  logger: FastifyBaseLogger;
  /** The client address, honouring TRUST_PROXY (getClientIp in lib/rate-limit.ts). */
  clientIp(req: IncomingMessage): string;
  /** The signed-in user behind the request's session cookie, if any. */
  resolveSession(req: IncomingMessage): Promise<ResolvedSession | null>;
  hashIp(ip: string): string;
}
