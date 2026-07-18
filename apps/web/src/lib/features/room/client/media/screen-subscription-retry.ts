export const SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS = [150, 600, 1500] as const;
export const SCREEN_SUBSCRIPTION_RETRY_RESPONSE_MS = 600;

interface ScreenSubscriptionRetryTarget {
  isAttached: () => boolean;
  isCurrent: () => boolean;
  isDemanded: () => boolean;
  key: string;
  retry: () => void;
}

interface ScreenSubscriptionRetryState {
  attempts: number;
  timer: number;
}

interface ScreenSubscriptionRetryScheduler {
  clearTimer?: (timer: number) => void;
  delays?: readonly number[];
  responseMs?: number;
  setTimer?: (callback: () => void, delay: number) => number;
}

export function createScreenSubscriptionRetryController(
  scheduler: ScreenSubscriptionRetryScheduler = {}
) {
  const delays = scheduler.delays || SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS;
  const responseMs = scheduler.responseMs ?? SCREEN_SUBSCRIPTION_RETRY_RESPONSE_MS;
  const setTimer = scheduler.setTimer || ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimer = scheduler.clearTimer || ((timer) => window.clearTimeout(timer));
  const retries = new Map<string, ScreenSubscriptionRetryState>();

  const clear = (key: string): void => {
    const retry = retries.get(key);
    if (retry?.timer) clearTimer(retry.timer);
    retries.delete(key);
  };

  const schedule = (target: ScreenSubscriptionRetryTarget): void => {
    if (!target.isCurrent() || !target.isDemanded()) {
      clear(target.key);
      return;
    }

    const retry = retries.get(target.key) || { attempts: 0, timer: 0 };
    if (retry.timer || retry.attempts >= delays.length) return;

    retry.timer = setTimer(() => {
      retry.timer = 0;
      if (!target.isCurrent() || !target.isDemanded()) {
        clear(target.key);
        return;
      }
      if (target.isAttached()) {
        clear(target.key);
        return;
      }

      retry.attempts += 1;
      retry.timer = setTimer(() => {
        retry.timer = 0;
        if (!target.isCurrent() || !target.isDemanded()) {
          clear(target.key);
          return;
        }
        if (target.isAttached()) {
          clear(target.key);
          return;
        }
        schedule(target);
      }, responseMs);
      // Reserve the response window before invoking the retry. LiveKit events
      // are normally asynchronous, but a synchronous failure callback must not
      // create a second delay timer for the same SID and exceed the epoch cap.
      target.retry();
    }, delays[retry.attempts]);
    retries.set(target.key, retry);
  };

  const clearAll = (): void => {
    for (const key of retries.keys()) clear(key);
  };

  return {
    clear,
    clearAll,
    getAttempts: (key: string): number => retries.get(key)?.attempts || 0,
    schedule
  };
}
