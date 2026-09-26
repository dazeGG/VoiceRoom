// The signed-in account behind a request: the session cookie resolved through
// the user store, plus the names and colours a session shows in rooms.

import type { IncomingMessage } from 'node:http';
import { accountPeerIdFor, cleanName } from '@voice-room/shared/validation';
import type { createUserStore } from '../lib/user-store.ts';
import type { GeoLocator } from '../lib/geoip.ts';

type SessionRequest = IncomingMessage & { voiceRoomUserId?: string };

export interface SessionResolverDeps {
  readToken(req: IncomingMessage): string | null | undefined;
  users(): Pick<ReturnType<typeof createUserStore>, 'getSessionUser'>;
  geo(): Pick<GeoLocator, 'locate'>;
  clientIp(req: IncomingMessage): string;
}

export function createSessionResolver(deps: SessionResolverDeps) {
  async function resolve(req: SessionRequest) {
    const token = deps.readToken(req);
    if (!token) return null;
    const session = await deps.users().getSessionUser(token, Date.now(), {
      userAgent: String(req.headers['user-agent'] || ''),
      resolveLocation: () => deps.geo().locate(deps.clientIp(req))
    });
    // Stamped for the request-completed record: without it every authenticated
    // request looks anonymous in the log and a user's report cannot be traced to
    // the requests they actually made.
    if (session?.user?.id) req.voiceRoomUserId = session.user.id;
    return session;
  }

  return { resolve };
}

export function sessionAvatarColorKey(user: { id?: string; avatarColorKey?: unknown } | null | undefined): string {
  return typeof user?.avatarColorKey === 'string' ? user.avatarColorKey : '';
}

export function sessionDisplayName(user: { displayName?: unknown; login?: unknown } | null | undefined): string {
  if (!user) return '';
  return cleanName(user.displayName || user.login);
}

export function sessionChatPeerId(user: { id?: string } | null | undefined) {
  return accountPeerIdFor(user?.id);
}
