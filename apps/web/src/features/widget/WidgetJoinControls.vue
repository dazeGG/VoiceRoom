<script setup lang="ts">
import { KeyRound, Plus } from '@lucide/vue';
import { DEFAULT_WIDGET_TITLE } from '@voice-room/shared/contracts/widget';

withDefaults(defineProps<{ preview?: boolean; title?: string | undefined }>(), {
  preview: false,
  title: DEFAULT_WIDGET_TITLE
});
const name = defineModel<string>('name', { default: '' });
const code = defineModel<string>('code', { default: '' });
defineEmits<{ create: []; join: [] }>();
</script>

<template>
  <div class="widget-entry">
    <h1 class="widget-entry__title">{{ title }}</h1>
    <label class="widget-entry__field">
      Ваше имя
      <input v-model="name" :disabled="preview" maxlength="80" placeholder="Как вас зовут?" autocomplete="nickname" />
    </label>
    <form class="widget-entry__form" @submit.prevent="$emit('join')">
      <button class="widget-entry__create" type="button" :disabled="preview" @click="$emit('create')">
        <Plus :size="18" aria-hidden="true" />Создать комнату
      </button>
      <span class="widget-entry__divider">или войти по коду</span>
      <div class="widget-entry__join">
        <label class="widget-entry__code">
          <KeyRound :size="17" aria-hidden="true" />
          <span class="widget-entry__sr-only">Код комнаты</span>
          <input
            v-model="code"
            :disabled="preview"
            required
            maxlength="48"
            placeholder="Код комнаты"
            autocapitalize="none"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <button type="submit" :disabled="preview">Войти</button>
      </div>
    </form>
  </div>
</template>
