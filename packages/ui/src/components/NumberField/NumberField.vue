<script setup lang="ts">
import { Minus, Plus } from '@lucide/vue';
import { localeTag } from '@voice-room/shared/localization';
import { getLocale, t } from '@voice-room/ui/i18n';
import { NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput, NumberFieldRoot } from 'reka-ui';
import { useId } from 'vue';
import { useFieldControl } from '../Field/context';
import IconButton from '../IconButton/IconButton.vue';
import type { NumberFieldProps } from './types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<NumberFieldProps>(), { size: 'md' });
const value = defineModel<number | null>({ default: null });
const controlAttrs = useFieldControl();
const id = useId();

function update(next: number | undefined): void {
  value.value = next ?? null;
}
</script>

<template>
  <NumberFieldRoot
    :id="controlAttrs($attrs).id ?? id"
    :model-value="value"
    v-bind="{
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
      ...(step !== undefined && { step })
    }"
    :name="name ?? ''"
    :disabled="disabled"
    :readonly="readonly"
    :allow-invalid="allowInvalid"
    :locale="localeTag(getLocale())"
    :class="['ui-input', `ui-input--${size}`, 'ui-number', $attrs.class]"
    @update:model-value="update"
  >
    <NumberFieldDecrement as-child>
      <IconButton :label="t('Уменьшить значение')" :size="28">
        <Minus aria-hidden="true" />
      </IconButton>
    </NumberFieldDecrement>
    <NumberFieldInput
      v-bind="controlAttrs({ ...$attrs, class: undefined })"
      :id="controlAttrs($attrs).id ?? id"
      class="ui-input__control ui-number__value"
    />
    <NumberFieldIncrement as-child>
      <IconButton :label="t('Увеличить значение')" :size="28">
        <Plus aria-hidden="true" />
      </IconButton>
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>
