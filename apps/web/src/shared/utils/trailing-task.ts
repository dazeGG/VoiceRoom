// Work asked for many times that only needs doing once for all of them: a burst
// of calls ends in one run, a moment after the first, so it sees all of the burst.

export function createTrailingTask(delayMs: number, task: () => void): { schedule(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        task();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  };
}
