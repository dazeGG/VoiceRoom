// Embedded in each API process. Per-job database claims fence duplicate work
// across processes, and stop waits for the current batch before pool teardown.
import type { RingService } from './ring.service.ts';
export function createRingDeliveryRuntime({
  rings,
  callMaintenance,
  callPush,
  enabled,
  onError
}: {
  rings: RingService;
  callMaintenance?: () => Promise<void>;
  callPush?: { prune(): Promise<void> | undefined; drainOnce(): Promise<boolean> };
  enabled: () => boolean;
  onError: (error: unknown) => void;
}) {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = Promise.resolve();
  function failed(error: unknown): false {
    onError(error);
    return false;
  }
  async function tick() {
    try {
      if (enabled()) {
        await rings.maintenance();
        await callMaintenance?.();
        await callPush?.prune();
        for (let n = 0; n < 20 && !stopped; n++) {
          const [invites, calls] = await Promise.all([
            rings.drainOnce().catch(failed),
            callPush?.drainOnce().catch(failed)
          ]);
          if (!invites && !calls) break;
        }
      }
    } catch (error) {
      onError(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(run, 500);
        timer.unref();
      }
    }
  }
  function run() {
    pending = tick();
  }
  function start() {
    if (!stopped) return;
    stopped = false;
    run();
  }
  async function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    await pending;
  }
  return { start, stop };
}
