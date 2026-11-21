<script setup lang="ts">
import { RadioGroupItem } from 'reka-ui';
import { useId } from 'vue';
import type { RadioGroupItemProps } from './types';

defineProps<RadioGroupItemProps>();
const id = useId();
const labelId = `${id}-label`;
const descriptionId = `${id}-description`;
</script>

<template>
  <RadioGroupItem
    :class="variant === 'tile' ? 'ui-choice--tile' : ['ui-choice', { 'ui-choice--card': variant === 'card' }]"
    :value="option.value"
    :disabled="option.disabled ?? false"
    :aria-labelledby="variant === 'tile' ? undefined : labelId"
    :aria-label="variant === 'tile' ? option.label : undefined"
    :aria-describedby="option.description ? descriptionId : undefined"
  >
    <slot v-if="variant === 'tile'" />
    <template v-else>
      <span v-if="variant === 'card' && $slots.preview" class="ui-choice__preview">
        <slot name="preview" />
      </span>
      <span class="ui-choice__row">
        <span class="ui-radio" aria-hidden="true"></span>
        <span class="ui-choice__text">
          <span :id="labelId"
            ><slot>{{ option.label }}</slot></span
          >
          <small v-if="option.description" :id="descriptionId" class="ui-choice__description">{{
            option.description
          }}</small>
        </span>
      </span>
    </template>
  </RadioGroupItem>
</template>
