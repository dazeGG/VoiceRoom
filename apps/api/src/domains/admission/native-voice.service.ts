import { createHash, randomUUID } from 'node:crypto';
import type {
  NativeVoiceAdmission,
  NativeVoiceAdmissionBody,
  NativeVoicePreference,
  NativeVoiceRenewal,
  NativeVoiceRenewalBody,
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
const COMPANIONS_PER_ACCOUNT = 2;
// A renderer can report its fallback on the first poll or leave after revocation.
export const NATIVE_VOICE_REPORT_GRACE_MS = 60_000;
export type NativeVoiceAttempt = { retiredAt?: number };

type Decision<T> =
  | { status: 'issued'; admission: T }
  | { status: 'off' | 'ineligible' | 'wrong_room' | 'stale' | 'banned' | 'capacity' | 'unavailable' };
type Caller = { accountId: string; authSessionHash: string; ip: string };
type LiveLease = NativeVoiceLease & {
  authSessionHash: string;
  sliding: boolean;
  attempt: NativeVoiceAttempt;
  policyRevoked?: true;
};

function owns(peer: AdmissionPeer | null, body: NativeVoiceAdmissionBody, { accountId, authSessionHash }: Caller) {
  return (
    peer?.desktop === true &&
    peer.accountUserId === accountId &&
    peer.transportId === body.generation &&
    tokensMatch(peer.authSessionHash, authSessionHash) &&
    tokensMatch(peer.sessionToken, body.sessionToken)
  );
}

export function createNativeVoiceService(deps: {
  policy(): { stage: NativeVoiceStage; accounts: ReadonlySet<string>; cap: number; defaultPercent: number };
  repository(): NativeVoiceRepository | null;
  provider(): LiveKitCredentialProvider | null;
  rosterPeer(roomId: string, peerId: string): AdmissionPeer | null;
  mainRoom(roomId: string): Promise<boolean>;
  banned(roomId: string, accountId: string, ip: string): Promise<unknown>;
  roomName(roomId: string): string;
  removeParticipant(roomId: string, identity: string): Promise<void>;
  publish(roomId: string, mapping: NativeVoiceCompanions): void;
  noteIssued?(roomId: string, peerId: string, generation: string, attempt: NativeVoiceAttempt): void;
  publishRevocation?(roomId: string, peerId: string, generation: string): void;
  logger(): Pick<Logger, 'error'>;
  recordFailure(): void;
}) {
  const issuing = new Set<string>();
  const cleaning = new Map<string, Promise<void>>();
  const live = new Map<string, LiveLease>();
  let slots = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let stopping = false;

  const stageFor = (account: string, peer: AdmissionPeer | null): NativeVoiceStage => {
    const { stage, accounts, cap, defaultPercent } = deps.policy();
    if (stopping || cap <= 0 || stage === 'off') return 'off';
    if (accounts.has(account)) return stage;
    const preference: NativeVoicePreference = peer?.nativeVoicePreference ?? 'default';
    if (stage === 'internal-join' || !peer?.nativeVoiceReceive || preference === 'off') return 'off';
    if (preference === 'on') return stage;
    const bucket = createHash('sha256').update(account).digest().readUInt32BE() % 100;
    return bucket < defaultPercent ? stage : 'off';
  };

  function capability(roomId: string, peerId: string): RoomSnapshot['nativeVoice'] {
    const peer = deps.rosterPeer(roomId, peerId);
    if (!peer?.desktop || !peer.accountUserId || !peer.authSessionHash) return undefined;
    return {
      version: 1,
      stage: stageFor(peer.accountUserId, peer),
      generation: peer.transportId
    };
  }

  function current(lease: LiveLease): boolean {
    const peer = deps.rosterPeer(lease.room_id, lease.peer_id);
    const stage = stageFor(lease.account_id, peer);
    return (
      !lease.policyRevoked &&
      lease.expires_at.getTime() > Date.now() &&
      peer?.desktop === true &&
      peer.accountUserId === lease.account_id &&
      peer.transportId === lease.generation &&
      tokensMatch(peer.authSessionHash, lease.authSessionHash) &&
      (lease.sliding ? stage === 'receive' : stage !== 'off')
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
    const active = live.get(id);
    if (active) {
      active.attempt.retiredAt = Date.now();
      live.delete(id);
      deps.publish(roomId, mapping(roomId));
    }
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
    const active = live.get(lease.id);
    const validUntil = new Date(Date.now() + HEARTBEAT_MS);
    if (active && current(active) && (await repo.extend(lease.id, validUntil)) && current(active)) {
      if (!active.valid_until || active.valid_until < validUntil) active.valid_until = validUntil;
      return;
    }
    scheduleRetirement(repo, lease);
  }

  function reconcile(): Promise<void> {
    // Push policy revocation to the owning renderer even while the DB or SFU is blocked.
    for (const lease of live.values()) {
      if (!lease.sliding || lease.policyRevoked) continue;
      const peer = deps.rosterPeer(lease.room_id, lease.peer_id);
      if (peer?.transportId !== lease.generation) continue;
      if (stageFor(lease.account_id, peer) === 'receive' && peer.nativeVoicePreference !== 'off') continue;
      lease.policyRevoked = true;
      deps.publishRevocation?.(lease.room_id, lease.peer_id, lease.generation);
    }
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

  async function admit(body: NativeVoiceAdmissionBody, caller: Caller): Promise<Decision<NativeVoiceAdmission>> {
    const { accountId, authSessionHash, ip } = caller;
    const { roomId, peerId, generation } = body;
    if (deps.policy().stage === 'off' || stopping) return { status: 'off' };
    const roster = () => deps.rosterPeer(roomId, peerId);
    const stage = (peer: AdmissionPeer | null) => stageFor(accountId, peer?.accountUserId === accountId ? peer : null);
    const initialStage = stage(roster());
    if (initialStage === 'off' || isReservedPeerId(peerId)) return { status: 'ineligible' };
    if (!(await deps.mainRoom(roomId))) return { status: 'wrong_room' };
    if (!owns(roster(), body, caller)) return { status: 'stale' };
    if (await deps.banned(roomId, accountId, ip)) return { status: 'banned' };
    const repo = deps.repository();
    const provider = deps.provider();
    if (!repo || !provider) return { status: 'unavailable' };

    const id = randomUUID();
    const sliding = initialStage === 'receive';
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
    const eligible = () => {
      const peer = roster();
      return owns(peer, body, caller) && stage(peer) === initialStage && Date.now() < expiresAt;
    };
    if (!eligible()) return { status: 'stale' };
    issuing.add(id);
    let reserved = false;
    let issued = false;
    try {
      reserved = await repo.reserve(lease, deps.policy().cap, COMPANIONS_PER_ACCOUNT);
      if (!reserved) return { status: 'capacity' };
      slots += 1;
      if (!eligible()) return { status: 'stale' };
      const result = await provider.issueAdmission({
        roomId,
        livekitRoom: deps.roomName(roomId),
        peerId,
        principal: { principalType: 'account', principalId: accountId },
        companion: { id, expiresAt, sliding }
      });
      if (result.status !== 'issued') return { status: 'unavailable' };
      if (await deps.banned(roomId, accountId, ip)) return { status: 'banned' };
      if (!eligible() || !(await deps.mainRoom(roomId)) || !eligible()) return { status: 'stale' };
      const validUntil = new Date(Date.now() + HEARTBEAT_MS);
      await repo.activate(id, validUntil);
      if (!eligible()) return { status: 'stale' };
      const { room, token, ttlSeconds, url } = result.admission;
      const attempt: NativeVoiceAttempt = {};
      live.set(id, { ...lease, authSessionHash, sliding, attempt, valid_until: validUntil, retired_at: null });
      deps.publish(roomId, mapping(roomId));
      if (!eligible()) return { status: 'stale' };
      issued = true;
      deps.noteIssued?.(roomId, peerId, generation, attempt);
      return {
        status: 'issued',
        admission: {
          ok: true,
          version: 1,
          identity: nativeVoiceIdentity(peerId, id),
          generation,
          ...(sliding && { leaseId: id }),
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

  async function renew(body: NativeVoiceRenewalBody, caller: Caller): Promise<Decision<NativeVoiceRenewal>> {
    const { roomId, peerId, generation, leaseId } = body;
    const { accountId, authSessionHash, ip } = caller;
    if (deps.policy().stage !== 'receive' || stopping) return { status: 'off' };
    const lease = live.get(leaseId);
    if (
      !lease?.sliding ||
      lease.room_id !== roomId ||
      lease.peer_id !== peerId ||
      lease.generation !== generation ||
      lease.account_id !== accountId ||
      !tokensMatch(lease.authSessionHash, authSessionHash)
    )
      return { status: 'stale' };

    const roster = () => deps.rosterPeer(roomId, peerId);
    const eligible = (peer: AdmissionPeer | null) =>
      peer?.nativeVoicePreference !== 'off' && stageFor(accountId, peer) === 'receive';
    if (!owns(roster(), body, caller)) return { status: 'stale' };
    if (!eligible(roster())) return { status: 'ineligible' };
    if (!(await deps.mainRoom(roomId))) return { status: 'wrong_room' };
    if (await deps.banned(roomId, accountId, ip)) return { status: 'banned' };
    const repo = deps.repository();
    const provider = deps.provider();
    if (!repo || !provider) return { status: 'unavailable' };
    const token = await provider.refreshCompanionToken({
      roomId,
      livekitRoom: deps.roomName(roomId),
      peerId,
      id: leaseId
    });
    if (!token) return { status: 'unavailable' };

    const stillOwned = () => {
      const peer = roster();
      return (
        live.get(leaseId) === lease &&
        !lease.policyRevoked &&
        !cleaning.has(leaseId) &&
        owns(peer, body, caller) &&
        eligible(peer)
      );
    };
    if (!stillOwned()) return { status: 'stale' };
    const now = Date.now();
    const validUntil = new Date(now + HEARTBEAT_MS);
    const expiresAt = await repo.renew(leaseId, new Date(now + LEASE_MS), validUntil);
    if (!expiresAt) return { status: 'stale' };
    if (!stillOwned()) {
      scheduleRetirement(repo, lease);
      return { status: 'stale' };
    }
    if (lease.expires_at < expiresAt) lease.expires_at = expiresAt;
    if (!lease.valid_until || lease.valid_until < validUntil) lease.valid_until = validUntil;
    return { status: 'issued', admission: { ok: true, version: 1, leaseId, expiresAt: expiresAt.getTime(), token } };
  }

  return {
    admit,
    renew,
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
