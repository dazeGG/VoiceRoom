const MAX_CONCURRENT_REMOVALS = 4;

type Target = {
  roomId: string;
  userId: string;
  peerId: string;
  revoked: boolean;
  revocation: Promise<void> | null;
  attempt: PromiseWithResolvers<boolean> | null;
  running: boolean;
};

export function createCallSeatCleanup(deps: {
  revoke(roomId: string, userId: string, peerId: string): Promise<void>;
  remove(roomId: string, peerId: string): Promise<void>;
  reportFailure(): void;
}) {
  const targets = new Map<string, Target>();
  let running = 0;
  let stopped = false;
  const key = (roomId: string, peerId: string) => `${roomId}:${peerId}`;

  function revoke(target: Target): Promise<void> {
    return (target.revocation ??= deps.revoke(target.roomId, target.userId, target.peerId));
  }

  async function remove(id: string, target: Target) {
    const attempt = target.attempt;
    if (!attempt) return;
    target.running = true;
    running++;
    try {
      if (!target.revoked) {
        await revoke(target);
        target.revoked = true;
      }
      if (stopped) return;
      await deps.remove(target.roomId, target.peerId);
      targets.delete(id);
      attempt.resolve(true);
    } catch {
      target.attempt = null;
      target.revocation = null;
      attempt.resolve(false);
      if (!stopped) deps.reportFailure();
    } finally {
      running--;
      target.running = false;
      pump();
    }
  }

  function pump() {
    if (stopped) return;
    for (const [id, target] of targets) {
      if (running >= MAX_CONCURRENT_REMOVALS) break;
      if (target.attempt && !target.running) void remove(id, target);
    }
  }

  return {
    schedule(roomId: string, userId: string, peerId: string, liveSeat: boolean) {
      const id = key(roomId, peerId);
      if (stopped || targets.has(id)) return;
      const target: Target = {
        roomId,
        userId,
        peerId,
        revoked: false,
        revocation: null,
        attempt: Promise.withResolvers<boolean>(),
        running: false
      };
      targets.set(id, target);
      // Revoke live seats even when every SFU worker is busy.
      if (liveSeat) void revoke(target).catch(() => {});
      pump();
    },
    wait(roomId: string, peerId: string): Promise<boolean> | null {
      const target = targets.get(key(roomId, peerId));
      return target ? (target.attempt?.promise ?? Promise.resolve(false)) : null;
    },
    has(roomId: string, peerId: string): boolean {
      return targets.has(key(roomId, peerId));
    },
    pendingInRoom(roomId: string): boolean {
      return [...targets.values()].some((target) => target.roomId === roomId);
    },
    retry() {
      for (const target of targets.values()) target.attempt ??= Promise.withResolvers<boolean>();
      pump();
    },
    stop() {
      stopped = true;
      for (const target of targets.values()) target.attempt?.resolve(false);
      targets.clear();
    }
  };
}
