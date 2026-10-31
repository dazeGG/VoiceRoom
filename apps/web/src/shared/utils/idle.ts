// Work the visitor may need later, run when it no longer competes with what
// they see now: after the page has loaded, in the browser's first idle moment
// (or a short pause where requestIdleCallback is missing, as in Safari).

const IDLE_TIMEOUT_MS = 3_000;
const FALLBACK_DELAY_MS = 200;

/** Schedules `task`; the returned function cancels it if it has not run yet. */
export function whenIdle(task: () => void): () => void {
  let cancelled = false;
  let cancelScheduled = () => {};
  const run = () => {
    if (!cancelled) task();
  };
  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      cancelScheduled = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(run, FALLBACK_DELAY_MS);
      cancelScheduled = () => window.clearTimeout(handle);
    }
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', schedule);
    cancelScheduled();
  };
}
