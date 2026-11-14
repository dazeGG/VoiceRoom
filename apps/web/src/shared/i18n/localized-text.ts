import { computed, shallowRef } from 'vue';
import { errorText } from '@/api/error-texts';

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

/** Known API failures have semantic codes; unknown/server-provided messages stay unchanged. */
export function currentErrorMessage(error: { message: string; code?: unknown }): string {
  return typeof error.code === 'string' ? (errorText(error.code) ?? error.message) : error.message;
}
