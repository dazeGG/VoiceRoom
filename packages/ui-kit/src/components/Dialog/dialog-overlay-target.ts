import { computed, shallowReactive, watch, type Ref } from 'vue';

const targets = shallowReactive<HTMLElement[]>([]);

/** Interactive global notices belong inside the top modal's focus scope. */
export const useDialogOverlayTarget = () => computed(() => targets.at(-1));

export function registerDialogOverlayTarget(target: Ref<HTMLElement | null>): void {
  watch(
    target,
    (element, _, onCleanup) => {
      if (!element) return;
      targets.push(element);
      onCleanup(() => {
        const index = targets.indexOf(element);
        if (index >= 0) targets.splice(index, 1);
      });
    },
    { flush: 'post' }
  );
}
