import { computed, ref, watch, type Ref } from 'vue';
import { readStorage, writeStorage } from '@/shared/storage';

const HEIGHT_KEY = 'voice-room:dm-call-height';
const STAGE_MIN = 216;
const CHAT_MIN = 200;

export function useDmCallHeight(container: Readonly<Ref<HTMLElement | null>>) {
  const savedHeight = Number(readStorage(HEIGHT_KEY));
  const preferred = ref(Number.isFinite(savedHeight) && savedHeight > 0 ? savedHeight : null);
  const available = ref(window.innerHeight - 56);
  const min = computed(() => Math.max(1, Math.min(STAGE_MIN, Math.round(available.value * 0.4))));
  const max = computed(() => Math.max(min.value, available.value - CHAT_MIN));
  const size = computed(() =>
    Math.max(min.value, Math.min(max.value, preferred.value ?? Math.round(available.value * 0.4)))
  );

  watch(
    container,
    (element, _, onCleanup) => {
      if (!element) return;
      const measure = () => {
        const height = Math.round(element.getBoundingClientRect().height);
        if (height > 0) available.value = height;
      };
      measure();
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        onCleanup(() => observer.disconnect());
      } else {
        window.addEventListener('resize', measure);
        onCleanup(() => window.removeEventListener('resize', measure));
      }
    },
    { flush: 'post' }
  );

  function commit(height: number): void {
    preferred.value = height;
    writeStorage(HEIGHT_KEY, String(height));
  }

  return { min, max, size, commit };
}
