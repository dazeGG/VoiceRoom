import { normalizeRoomId, nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { RoomServiceClient } from 'livekit-server-sdk';
import { isNativeVoiceParticipantAbsent } from './livekit-admin.ts';
import type { NativeVoiceRepository } from './native-voice.repository.ts';
import {
  type createNativeVoiceWatchdog,
  MAX_NATIVE_VOICE_RETRY_MS,
  MAX_NATIVE_VOICE_WATCHES,
  nativeVoiceRetryDelay
} from './native-voice-watchdog.service.ts';

const DATABASE_LOOKUP_MS = 1_000;
const RECONCILE_MS = 1_000;
type DiscoveryRoom = { name: string; after: string };

export function createNativeVoiceRecovery({
  admin,
  repository,
  roomPrefix,
  watchdog,
  report
}: {
  admin: Pick<RoomServiceClient, 'listRooms' | 'listParticipants'>;
  repository: NativeVoiceRepository | null;
  roomPrefix: string;
  watchdog: ReturnType<typeof createNativeVoiceWatchdog>;
  report: (error: unknown) => void;
}) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let settling = false;
  let startedAt: Date;
  let retryMs = RECONCILE_MS;

  async function recoverWindows(room: string, identities: string[]) {
    if (!repository) return [];
    const timeout = AbortSignal.timeout(DATABASE_LOOKUP_MS);
    const deadline = new Promise<never>((_, reject) =>
      timeout.addEventListener('abort', () => reject(new Error('Native voice recovery database lookup timed out')), {
        once: true
      })
    );
    return Promise.race([repository.recover(room, identities, timeout), deadline]);
  }

  async function discover(remaining?: DiscoveryRoom[]): Promise<void> {
    const retryRooms: DiscoveryRoom[] = [];
    try {
      const rooms = remaining ?? (await admin.listRooms()).map(({ name }) => ({ name, after: '' }));
      let databaseAvailable = Boolean(repository);
      for (const candidate of rooms) {
        const { name } = candidate;
        if (stopped) return;
        if (!name.startsWith(roomPrefix)) continue;
        const room = name.slice(roomPrefix.length);
        if (!room || normalizeRoomId(room) !== room) continue;
        let identities: string[];
        try {
          identities = (await admin.listParticipants(name))
            .map(({ identity }) => identity)
            .filter((identity) => identity > candidate.after && identity.includes('#voice.'))
            .sort();
        } catch (error) {
          if (isNativeVoiceParticipantAbsent(error)) continue;
          report(error);
          retryRooms.push(candidate);
          continue;
        }
        if (identities.length === 0) continue;
        let verified = new Map<string, Awaited<ReturnType<typeof recoverWindows>>[number]>();
        if (databaseAvailable) {
          try {
            verified = new Map((await recoverWindows(room, identities)).map((window) => [window.identity, window]));
          } catch (error) {
            // Do not wait for PostgreSQL again in this sweep.
            report(error);
            databaseAvailable = false;
          }
        }
        if (stopped) return;
        let after = candidate.after;
        for (const identity of identities) {
          const window = verified.get(identity);
          const tracked = watchdog.recover({ room, identity }, window && { ...window, room }, async () => {
            const [current] = await recoverWindows(room, [identity]);
            return current?.deadline ?? null;
          });
          if (!tracked) {
            retryRooms.push({ name, after });
            break;
          }
          after = identity;
        }
      }
      if (retryRooms.length === 0) return;
    } catch (error) {
      report(error);
    }
    if (stopped) return;
    discoveryTimer = setTimeout(
      () => void discover(retryRooms.length ? retryRooms : undefined),
      nativeVoiceRetryDelay(retryMs)
    );
    discoveryTimer.unref();
    retryMs = Math.min(retryMs * 2, MAX_NATIVE_VOICE_RETRY_MS);
  }

  async function retire(): Promise<void> {
    if (!repository || settling || stopped) return;
    settling = true;
    try {
      for (const settlement of watchdog.settlements()) {
        await repository.finishCleanup(settlement.id, settlement.absent);
        settlement.acknowledge();
      }
      const rows = await repository.retired(MAX_NATIVE_VOICE_WATCHES, watchdog.retirements(), startedAt);
      if (stopped) return;
      for (const { id, room_id: room, peer_id: peer, retired_at: retiredAt } of rows) {
        watchdog.retire({ room, identity: nativeVoiceIdentity(peer, id) }, id, retiredAt.getTime());
      }
    } catch {
      // The durable handoff resumes on the next database sweep.
    } finally {
      settling = false;
    }
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      startedAt = new Date();
      retryMs = RECONCILE_MS;
      void discover();
      void retire();
      timer = setInterval(() => void retire(), RECONCILE_MS);
      timer.unref();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(discoveryTimer);
      timer = undefined;
    }
  };
}
