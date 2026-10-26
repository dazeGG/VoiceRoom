// Embedded in each API process. Per-job database claims fence duplicate work
// across processes, and stop waits for the current batch before pool teardown.
import type { RingService } from './ring.service.ts';
export function createRingDeliveryRuntime({
  rings,
  enabled,
  onError
}: {
  rings: RingService;
  enabled: () => boolean;
  onError: (error: unknown) => void;
}) {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = Promise.resolve();
  async function tick() {
    try {
      if (enabled()) {
        await rings.maintenance();
        for (let n = 0; n < 20 && !stopped; n++) if (!(await rings.drainOnce())) break;
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
