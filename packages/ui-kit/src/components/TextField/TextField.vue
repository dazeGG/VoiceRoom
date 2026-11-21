<script setup lang="ts">
import { Eye, EyeOff, X } from '@lucide/vue';
import { t } from '@voiceroom/ui-kit/i18n';
import { ref, useTemplateRef } from 'vue';
import { useFieldControl } from '../Field/context';
import IconButton from '../IconButton/IconButton.vue';
import type { TextFieldProps } from './types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<TextFieldProps>(), { size: 'md', type: 'text' });
const value = defineModel<string>({ default: '' });
const revealed = ref(false);
const input = useTemplateRef<HTMLInputElement>('input');
defineExpose({ input });
const controlAttrs = useFieldControl();

function clear(): void {
  value.value = '';
  input.value?.focus();
}
</script>

<template>
  <div
    class="ui-input"
    :class="[
      `ui-input--${size}`,
      { 'ui-input--mono': variant === 'mono' || variant === 'code', 'ui-input--code': variant === 'code' },
      $attrs.class
    ]"
  >
    <span v-if="$slots.leading" class="ui-input__icon" aria-hidden="true"><slot name="leading" /></span>
    <input
      v-bind="controlAttrs({ ...$attrs, class: undefined })"
      ref="input"
      v-model="value"
      class="ui-input__control"
      :type="type === 'password' && revealed ? 'text' : type"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :name="name"
      :disabled="disabled"
      :readonly="readonly"
    />
    <div v-if="type === 'password' || (clearable && value && !readonly) || $slots.trailing" class="ui-input__actions">
      <IconButton
        v-if="clearable && value && !readonly"
        :label="t('Очистить')"
        :size="24"
        :disabled="disabled"
        @click="clear"
      >
        <X aria-hidden="true" />
      </IconButton>
      <IconButton
        v-if="type === 'password'"
        :label="revealed ? t('Скрыть пароль') : t('Показать пароль')"
        :size="24"
        :aria-pressed="revealed"
        :disabled="disabled"
        @click="revealed = !revealed"
      >
        <EyeOff v-if="revealed" aria-hidden="true" />
        <Eye v-else aria-hidden="true" />
      </IconButton>
      <slot name="trailing" />
    </div>
  </div>
</template>
