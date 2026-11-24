import { randomUUID } from 'node:crypto';
import type {
  NativeVoiceAdmission,
  NativeVoiceAdmissionBody,
  NativeVoiceStage
} from '@voiceroom/shared/contracts/admission';
import type { NativeVoiceCompanions, RoomSnapshot } from '@voiceroom/shared/contracts/realtime';
import { isReservedPeerId, nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { Logger } from 'pino';
import { tokensMatch } from '../../platform/crypto/tokens-match.ts';
import type { AdmissionPeer } from './admission.service.ts';
import type { LiveKitCredentialProvider } from './livekit-credential-provider.ts';
import type { NativeVoiceLease, NativeVoiceRepository } from './native-voice.repository.ts';

const LEASE_MS = 60_000;
const SWEEP_MS = 1_000;
// Losing the API heartbeat fails closed at the gate even before restart cleanup.
const HEARTBEAT_MS = 5_000;

type Decision =
  | { status: 'issued'; admission: NativeVoiceAdmission }
  | { status: 'off' | 'ineligible' | 'wrong_room' | 'stale' | 'banned' | 'capacity' | 'unavailable' };

export function createNativeVoiceService(deps: {
  policy(): { stage: NativeVoiceStage; accounts: ReadonlySet<string>; cap: number };
  repository(): NativeVoiceRepository | null;
  provider(): LiveKitCredentialProvider | null;
  rosterPeer(roomId: string, peerId: string): AdmissionPeer | null;
  mainRoom(roomId: string): Promise<boolean>;
  banned(roomId: string, accountId: string, ip: string): Promise<unknown>;
  roomName(roomId: string): string;
  removeParticipant(roomId: string, identity: string): Promise<void>;
  publish(roomId: string, mapping: NativeVoiceCompanions): void;
  logger(): Pick<Logger, 'error'>;
  recordFailure(): void;
}) {
  const issuing = new Set<string>();
  const cleaning = new Map<string, Promise<void>>();
  const live = new Map<string, NativeVoiceLease>();
  let slots = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let stopping = false;

  const stageFor = (account: string): NativeVoiceStage => {
    const { stage, accounts, cap } = deps.policy();
    return !stopping && cap > 0 && accounts.has(account) ? stage : 'off';
  };
  const allowed = (account: string) => stageFor(account) !== 'off';

  function capability(roomId: string, peerId: string): RoomSnapshot['nativeVoice'] {
    const peer = deps.rosterPeer(roomId, peerId);
    if (!peer?.desktop || !peer.accountUserId || !peer.authSessionHash) return undefined;
    return { version: 1, stage: stageFor(peer.accountUserId), generation: peer.transportId };
  }

  function current(lease: NativeVoiceLease): boolean {
    const peer = deps.rosterPeer(lease.room_id, lease.peer_id);
    return (
      allowed(lease.account_id) &&
      lease.expires_at.getTime() > Date.now() &&
      peer?.desktop === true &&
      peer.accountUserId === lease.account_id &&
      peer.transportId === lease.generation
    );
  }

  function mapping(roomId: string): NativeVoiceCompanions {
    const companions = [...live.values()]
      .filter((lease) => lease.room_id === roomId && current(lease) && (lease.valid_until?.getTime() ?? 0) > Date.now())
      .map((lease) => ({ identity: nativeVoiceIdentity(lease.peer_id, lease.id), peerId: lease.peer_id }));
    return { version: 1, companions };
  }

  async function retire(repo: NativeVoiceRepository, lease: NativeVoiceLease): Promise<void> {
    const { id, room_id: roomId, peer_id: peerId } = lease;
    const retired = await repo.retire(lease, new Date());
    if (live.delete(id)) deps.publish(roomId, mapping(roomId));
    if (retired) await deps.removeParticipant(roomId, nativeVoiceIdentity(peerId, id));
  }

  function report(error: unknown): void {
    deps.recordFailure();
    deps.logger().error({ evt: 'native_voice.cleanup_failed', err: error }, 'native voice cleanup failed');
  }

  function scheduleRetirement(repo: NativeVoiceRepository, lease: NativeVoiceLease): void {
    if (lease.retired_at || cleaning.has(lease.id)) return;
    const cleanup = retire(repo, lease)
      .catch(report)
      .finally(() => cleaning.delete(lease.id))
      .then(() => {});
    cleaning.set(lease.id, cleanup);
  }

  async function sweep(): Promise<void> {
    const repo = deps.repository();
    if (!repo) return;
    const rows = await repo.list();
    slots = rows.length;
    await Promise.all(
      rows
        .filter((lease) => !issuing.has(lease.id) && !cleaning.has(lease.id))
        .map((lease) => checkLease(repo, lease).catch(report))
    );
  }

  async function checkLease(repo: NativeVoiceRepository, lease: NativeVoiceLease): Promise<void> {
    const now = Date.now();
    const validUntil = new Date(now + HEARTBEAT_MS);
    if (live.has(lease.id) && current(lease) && (await repo.extend(lease.id, validUntil)) && current(lease)) {
      live.set(lease.id, { ...lease, valid_until: validUntil });
      return;
    }
    scheduleRetirement(repo, lease);
  }

  function reconcile(): Promise<void> {
    running ??= sweep()
      .catch(report)
      .finally(() => {
        running = undefined;
      });
    return running;
  }

  function start(): void {
    if (timer || !deps.repository()) return;
    stopping = false;
    void reconcile();
    timer = setInterval(() => void reconcile(), SWEEP_MS);
    timer.unref();
  }

  async function stop(): Promise<void> {
    stopping = true;
    clearInterval(timer);
    timer = undefined;
    await running;
    if (live.size || slots) await reconcile();
    await Promise.all(cleaning.values());
  }

  async function admit(
    body: NativeVoiceAdmissionBody,
    { accountId, authSessionHash, ip }: { accountId: string; authSessionHash: string; ip: string }
  ): Promise<Decision> {
    const { roomId, peerId, generation, sessionToken } = body;
    if (deps.policy().stage === 'off' || stopping) return { status: 'off' };
    if (!allowed(accountId) || isReservedPeerId(peerId)) return { status: 'ineligible' };
    if (!(await deps.mainRoom(roomId))) return { status: 'wrong_room' };
    const owns = () => {
      const peer = deps.rosterPeer(roomId, peerId);
      return (
        peer?.desktop &&
        peer.accountUserId === accountId &&
        peer.transportId === generation &&
        tokensMatch(peer.authSessionHash, authSessionHash) &&
        tokensMatch(peer.sessionToken, sessionToken)
      );
    };
    if (!owns()) return { status: 'stale' };
    if (await deps.banned(roomId, accountId, ip)) return { status: 'banned' };
    const repo = deps.repository();
    const provider = deps.provider();
    if (!repo || !provider) return { status: 'unavailable' };

    const id = randomUUID();
    const expiresAt = Date.now() + LEASE_MS;
    const lease = {
      id,
      room_id: roomId,
      peer_id: peerId,
      generation,
      account_id: accountId,
      expires_at: new Date(expiresAt),
      cleanup_exhausted_at: null
    };
    const eligible = () => owns() && allowed(accountId) && Date.now() < expiresAt;
    if (!eligible()) return { status: 'stale' };
    issuing.add(id);
    let reserved = false;
    let issued = false;
    try {
      reserved = await repo.reserve(lease, deps.policy().cap);
      if (!reserved) return { status: 'capacity' };
      slots += 1;
      if (!eligible()) return { status: 'stale' };
      const result = await provider.issueAdmission({
        roomId,
        livekitRoom: deps.roomName(roomId),
        peerId,
        principal: { principalType: 'account', principalId: accountId },
        companion: { id, expiresAt }
      });
      if (result.status !== 'issued') return { status: 'unavailable' };
      if (await deps.banned(roomId, accountId, ip)) return { status: 'banned' };
      if (!eligible() || !(await deps.mainRoom(roomId)) || !eligible()) return { status: 'stale' };
      const validUntil = new Date(Date.now() + HEARTBEAT_MS);
      await repo.activate(id, validUntil);
      if (!eligible()) return { status: 'stale' };
      const { room, token, ttlSeconds, url } = result.admission;
      live.set(id, { ...lease, valid_until: validUntil, retired_at: null });
      deps.publish(roomId, mapping(roomId));
      if (!eligible()) return { status: 'stale' };
      issued = true;
      return {
        status: 'issued',
        admission: {
          ok: true,
          version: 1,
          identity: nativeVoiceIdentity(peerId, id),
          generation,
          expiresAt,
          room,
          token,
          ttlSeconds,
          url
        }
      };
    } finally {
      if (reserved && !issued) scheduleRetirement(repo, { ...lease, valid_until: null, retired_at: null });
      issuing.delete(id);
    }
  }

  return {
    admit,
    capability,
    mapping,
    start,
    stop,
    rosterChanged: () => {
      if (live.size) void reconcile();
    },
    slotCount: () => slots
  };
}

export type NativeVoiceService = ReturnType<typeof createNativeVoiceService>;
