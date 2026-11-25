import { ref, watch } from 'vue';

// Align the next update with the timestamp so expiry works between wall-clock seconds.
export function useCallClock(timestamp: () => number | undefined, direction: 'until' | 'since') {
  const milliseconds = ref(0);
  watch(
    timestamp,
    (target, _previous, onCleanup) => {
      if (target === undefined || !Number.isFinite(target)) {
        milliseconds.value = 0;
        return;
      }

      let timer: ReturnType<typeof setTimeout>;
      function tick(at: number): void {
        const offset = Date.now() - at;
        milliseconds.value = Math.max(0, direction === 'until' ? -offset : offset);
        if (direction === 'until' && offset >= 0) return;
        const delay = offset < 0 ? -offset % 1000 || 1000 : 1000 - (offset % 1000);
        timer = setTimeout(tick, delay, at);
      }

      tick(target);
      onCleanup(() => clearTimeout(timer));
    },
    { immediate: true }
  );
  return milliseconds;
}

export function formatCallClock(seconds: number, padMinutes = false): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(hours || padMinutes ? 2 : 1, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}
