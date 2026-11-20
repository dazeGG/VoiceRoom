// The full product's durable voice history, including stays still open at shutdown.
import type { Logger } from 'pino';
import type { FinishedVoiceSession, VoiceSessionRepository } from '../domains/rooms/voice-session.repository.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import type { PresenceRoom, RosterPeer } from './room-presence.ts';

export function createVoiceStays(deps: {
  rooms(): Iterable<PresenceRoom>;
  sessions(): Pick<VoiceSessionRepository, 'recordSessions'> | null;
  logger(): Pick<Logger, 'error'>;
  now?: (() => number) | undefined;
}) {
  const now = deps.now ?? Date.now;
  const sessionWrites = new Set<Promise<void>>();
  let sessionsClosed = false;

  function finishedSession(target: PresenceRoom, peer: RosterPeer, leftAt: number): FinishedVoiceSession | null {
    if (!peer.joinedAt || target.kind === 'meet') return null;
    const userId = peer.accountUserId || null;
    return {
      roomId: target.id,
      roomKind: target.kind ?? null,
      userId,
      guestName: userId ? null : peer.name || null,
      guestId: userId ? null : peer.guestId || null,
      clientId: peer.clientId || null,
      client: peer.client ?? null,
      os: peer.os ?? '',
      browser: peer.browser ?? '',
      ip: peer.ip ?? '',
      joinedAt: peer.joinedAt,
      leftAt,
      ...(peer.voice?.minutes.length ? { minutes: [...peer.voice.minutes] } : {}),
      ...(peer.voice?.events.length ? { events: [...peer.voice.events] } : {}),
      ...(peer.voice?.joinTiming ? { joinTiming: peer.voice.joinTiming } : {})
    };
  }

  // A lost write costs one usage row, so it is logged rather than retried.
  function recordSessions(sessions: FinishedVoiceSession[]): void {
    const repository = deps.sessions();
    if (!repository || sessions.length === 0) return;
    const write = repository.recordSessions(sessions).catch((error: unknown) => {
      deps
        .logger()
        .error(
          { evt: LOG_EVENTS.ROOM_VOICE_SESSION_RECORD_FAILED, sessions: sessions.length, err: error },
          'failed to record voice sessions'
        );
    });
    sessionWrites.add(write);
    void write.finally(() => sessionWrites.delete(write));
  }

  /**
   * Records every stay still in the roster as ending now and waits for the
   * writes in flight. The process is stopping: its roster dies with it.
   */
  async function recordOpenSessions(): Promise<void> {
    if (!sessionsClosed) {
      sessionsClosed = true;
      const leftAt = now();
      const open: FinishedVoiceSession[] = [];
      for (const current of deps.rooms()) {
        for (const peer of current.peers.values()) {
          const session = finishedSession(current, peer, leftAt);
          if (session) open.push(session);
        }
      }
      recordSessions(open);
    }
    await Promise.all([...sessionWrites]);
  }

  function recordPeerLeft(room: PresenceRoom, peer: RosterPeer): void {
    const session = sessionsClosed ? null : finishedSession(room, peer, now());
    if (session) recordSessions([session]);
  }

  function reset(): void {
    sessionsClosed = false;
  }

  return { recordPeerLeft, recordOpenSessions, reset };
}
