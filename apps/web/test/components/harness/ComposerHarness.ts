// Test component: an EmojiComposer bound to a value that is printed next to it.

import { defineComponent, h, ref } from 'vue';
import type { ComposerHandle } from '@/shared/chat/composer-handle';
import EmojiComposer from '@/shared/chat/EmojiComposer.vue';

// What the harness hands its test, typed here since a component instance reads as untyped.
export type ComposerApi = {
  insert(text: string, caret?: number): boolean;
  setValue(next: string): void;
};

export type ComposerHarnessProps = {
  initial?: string;
  maxlength?: number;
  onApi?: (api: ComposerApi) => void;
};

/** A component rendering the composer with the given options. */
export function composerHarness(props: ComposerHarnessProps = {}) {
  return defineComponent(() => {
    const value = ref(props.initial ?? '');
    const composer = ref<ComposerHandle | null>(null);

    function insert(text: string, caret?: number): boolean {
      if (caret !== undefined) composer.value?.setSelection(caret);
      return composer.value?.insertText(text) ?? false;
    }

    function setValue(next: string): void {
      value.value = next;
    }

    props.onApi?.({ insert, setValue });

    return () => [
      h(EmojiComposer, {
        ref: composer,
        modelValue: value.value,
        'onUpdate:modelValue': (next: string) => (value.value = next),
        ariaLabel: 'Сообщение',
        maxlength: props.maxlength ?? Number.POSITIVE_INFINITY
      }),
      h('output', { 'data-testid': 'value' }, value.value)
    ];
  });
}
