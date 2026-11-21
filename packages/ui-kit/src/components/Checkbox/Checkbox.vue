<script setup lang="ts">
import { Check, Minus } from '@lucide/vue';
import { CheckboxIndicator, CheckboxRoot, Label } from 'reka-ui';
import { useId } from 'vue';
import type { CheckboxProps, CheckboxValue } from './types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<CheckboxProps>(), { size: 'md' });
const checked = defineModel<CheckboxValue>({ default: false });
const uid = useId();
const labelId = `${uid}-label`;
const descriptionId = `${uid}-description`;
</script>

<template>
  <Label class="ui-check" :class="$attrs.class" :for="id ?? uid">
    <CheckboxRoot
      v-bind="{ ...$attrs, class: undefined }"
      :id="id ?? uid"
      v-model="checked"
      :class="['ui-checkbox', `ui-checkbox--${size}`]"
      :disabled="disabled"
      :name="name ?? ''"
      :required="required"
      :aria-labelledby="$slots.default ? labelId : $attrs['aria-labelledby']"
      :aria-describedby="
        [$attrs['aria-describedby'], description && descriptionId].filter(Boolean).join(' ') || undefined
      "
    >
      <CheckboxIndicator as-child>
        <Minus v-if="checked === 'indeterminate'" aria-hidden="true" />
        <Check v-else aria-hidden="true" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="$slots.default || description" class="ui-check__text">
      <span v-if="$slots.default" :id="labelId"><slot /></span>
      <small v-if="description" :id="descriptionId" class="ui-check__description">{{ description }}</small>
    </span>
  </Label>
</template>
