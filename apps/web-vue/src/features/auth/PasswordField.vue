<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue';
import { ref } from 'vue';
import { iconMd } from '@/shared/ui/icons';

const value = defineModel<string>({ required: true });

withDefaults(
  defineProps<{ placeholder?: string; autocomplete?: 'current-password' | 'new-password'; id?: string | undefined }>(),
  {
    placeholder: '',
    autocomplete: 'current-password',
    id: undefined
  }
);

const revealed = ref(false);
</script>

<template>
  <div class="auth-password">
    <input
      :id="id"
      v-model="value"
      class="auth-dialog__input auth-password__input"
      :type="revealed ? 'text' : 'password'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
    />
    <button
      type="button"
      class="auth-password__eye"
      :aria-label="revealed ? 'Скрыть пароль' : 'Показать пароль'"
      :aria-pressed="revealed"
      @click="revealed = !revealed"
    >
      <EyeOff v-if="revealed" v-bind="iconMd" aria-hidden="true" />
      <Eye v-else v-bind="iconMd" aria-hidden="true" />
    </button>
  </div>
</template>
