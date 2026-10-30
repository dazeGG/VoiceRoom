// Timers the recovery controllers take as options, so tests can pass a fake
// clock. A handle is opaque: only the cancel of the same pair reads it.

export type TimerHandle = number | object;
export type ScheduleTimer = (callback: () => void, delay: number) => TimerHandle;
export type CancelTimer = (timer: TimerHandle) => void;

export const scheduleGlobalTimer: ScheduleTimer = (callback, delay) => globalThis.setTimeout(callback, delay);

export const cancelGlobalTimer: CancelTimer = (timer) => {
  if (isGlobalTimer(timer)) globalThis.clearTimeout(timer);
};

// What setTimeout hands back: a number in browsers, a Timeout object under Node.
function isGlobalTimer(value: unknown): value is ReturnType<typeof globalThis.setTimeout> {
  return typeof value === 'number' || (typeof value === 'object' && value !== null);
}
