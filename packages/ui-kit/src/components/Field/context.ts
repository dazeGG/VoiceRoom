import { inject, type AriaAttributes, type ComputedRef, type InjectionKey } from 'vue';
import type { FieldControlAttrs } from './types';

export const fieldControlKey: InjectionKey<ComputedRef<FieldControlAttrs>> = Symbol('fieldControl');

export function useFieldControl() {
  const field = inject(fieldControlKey, undefined);

  return (attrs: Record<string, unknown> = {}, descriptionId?: string) => {
    const state = attrs['aria-invalid'];
    const invalid: AriaAttributes['aria-invalid'] =
      state === true ||
      state === false ||
      state === 'true' ||
      state === 'false' ||
      state === 'grammar' ||
      state === 'spelling'
        ? state
        : undefined;
    return {
      ...attrs,
      id: field?.value.id ?? (typeof attrs.id === 'string' ? attrs.id : undefined),
      'aria-describedby':
        [attrs['aria-describedby'], field?.value['aria-describedby'], descriptionId].filter(Boolean).join(' ') ||
        undefined,
      'aria-invalid': field?.value['aria-invalid'] ?? invalid
    };
  };
}
