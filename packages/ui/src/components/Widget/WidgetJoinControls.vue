<script setup lang="ts">
import { KeyRound, Plus } from '@lucide/vue';
import { DEFAULT_WIDGET_TITLE } from '@voice-room/shared/contracts/widget';
import Button from '../Button/Button.vue';
import Field from '../Field/Field.vue';
import TextField from '../TextField/TextField.vue';

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
    <Field class="widget-entry__field" label="Ваше имя">
      <TextField
        v-model="name"
        size="lg"
        name="name"
        :disabled="preview"
        maxlength="80"
        placeholder="Как вас зовут?"
        autocomplete="nickname"
      />
    </Field>
    <form class="widget-entry__form" @submit.prevent="$emit('join')">
      <Button variant="primary" size="lg" :disabled="preview" @click="$emit('create')">
        <template #icon><Plus aria-hidden="true" /></template>
        Создать комнату
      </Button>
      <span class="widget-entry__divider">или войти по коду</span>
      <div class="widget-entry__join">
        <TextField
          v-model="code"
          size="lg"
          name="code"
          :disabled="preview"
          required
          maxlength="48"
          aria-label="Код комнаты"
          placeholder="Код комнаты"
          autocapitalize="none"
          spellcheck="false"
          autocomplete="off"
        >
          <template #leading><KeyRound /></template>
        </TextField>
        <Button size="lg" variant="outline" type="submit" :disabled="preview">Войти</Button>
      </div>
    </form>
  </div>
</template>
