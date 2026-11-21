<script setup lang="ts">
import { computed, useId, useTemplateRef } from 'vue';
import { useFieldControl } from '../Field/context';
import type { TextareaProps } from './types';

defineOptions({ inheritAttrs: false });

const props = defineProps<TextareaProps>();
const value = defineModel<string>({ default: '' });
const countId = useId();
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea');
defineExpose({ textarea });
const hasLimit = computed(() => props.maxlength !== undefined && props.maxlength >= 0);
const overLimit = computed(() => props.maxlength !== undefined && value.value.length > props.maxlength);
const controlAttrs = useFieldControl();
</script>

<template>
  <div class="ui-textarea" :class="$attrs.class">
    <div class="ui-textarea__sizer">
      <span class="ui-textarea__mirror" aria-hidden="true">{{ (value || placeholder || '') + ' ' }}</span>
      <textarea
        ref="textarea"
        v-bind="
          controlAttrs(
            { 'aria-invalid': overLimit || undefined, ...$attrs, class: undefined },
            hasLimit ? countId : undefined
          )
        "
        v-model="value"
        class="ui-textarea__control"
        :placeholder="placeholder"
        :name="name"
        :disabled="disabled"
        :readonly="readonly"
        :maxlength="hasLimit ? maxlength : undefined"
      />
    </div>
    <span v-if="hasLimit" :id="countId" class="ui-textarea__count" :class="{ 'ui-textarea__count--over': overLimit }">
      {{ value.length }} / {{ maxlength }}
    </span>
  </div>
</template>
