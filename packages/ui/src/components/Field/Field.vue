<script setup lang="ts">
import { CircleAlert } from '@lucide/vue';
import { t } from '@voice-room/ui/i18n';
import { Label } from 'reka-ui';
import { computed, provide, useId } from 'vue';
import { fieldControlKey } from './context';
import type { FieldControlAttrs, FieldProps } from './types';

const props = defineProps<FieldProps>();
defineSlots<{ default: (props: { control: FieldControlAttrs }) => unknown }>();

const uid = useId();
const controlId = computed(() => props.id ?? uid);
const hintId = `${uid}-hint`;
const errorId = `${uid}-error`;
const control = computed<FieldControlAttrs>(() => ({
  id: controlId.value,
  'aria-describedby': props.error ? errorId : props.hint ? hintId : undefined,
  'aria-invalid': props.error ? true : undefined
}));
provide(fieldControlKey, control);
</script>

<template>
  <div class="ui-field">
    <Label class="ui-field__label" :for="controlId">
      {{ label + (optional ? ' ' : '')
      }}<span v-if="optional" class="ui-field__optional">{{ t('· необязательно') }}</span>
    </Label>
    <slot :control="control" />
    <p v-if="error" :id="errorId" class="ui-field__error">
      <CircleAlert aria-hidden="true" />
      {{ error }}
    </p>
    <p v-else-if="hint" :id="hintId" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>
