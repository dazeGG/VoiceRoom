import { computed, shallowRef } from 'vue';

/** Keep active validation/error copy as a recipe, so changing locale recomputes it. */
export function useLocalizedText() {
  const source = shallowRef<string | (() => string)>('');
  return computed({
    get: (): string => (typeof source.value === 'function' ? source.value() : source.value),
    set: (value: string | (() => string)): void => {
      source.value = value;
    }
  });
}
