<script setup lang="ts">
// Edits one sent message in place: Enter saves, Escape or Отмена leaves it
// as it was. Shared by the room and direct chats; `variant` picks the
// surrounding chat's look.
import { onMounted, ref } from 'vue';
import type { ComposerHandle } from './composer-handle';
import EmojiComposer from './EmojiComposer.vue';

const {
  text: initialText,
  variant,
  maxlength,
  onSave
} = defineProps<{
  text: string;
  variant: 'dm-msg' | 'chat-msg';
  maxlength: number;
  /** Rejects when the server refuses; the editor stays open to retry. */
  onSave: (text: string) => Promise<void>;
}>();

const emit = defineEmits<{ close: [] }>();

const editor = ref<ComposerHandle | null>(null);
const text = ref(initialText);
const saving = ref(false);

onMounted(() => {
  editor.value?.focus();
  editor.value?.setSelection(text.value.length);
});

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void save();
  }
}

async function save(): Promise<void> {
  const trimmed = text.value.trim();
  if (!trimmed || saving.value) return;
  saving.value = true;
  try {
    await onSave(trimmed);
    emit('close');
  } catch {
    saving.value = false;
  }
}
</script>

<template>
  <div class="message-editor" :class="variant === 'dm-msg' ? 'message-editor--dm' : 'message-editor--chat'">
    <EmojiComposer
      ref="editor"
      v-model="text"
      class="message-editor__input"
      :maxlength="maxlength"
      aria-label="Текст сообщения"
      :disabled="saving"
      @keydown="onKeydown"
    />
    <div class="message-editor__actions">
      <button type="button" :disabled="saving" @click="emit('close')">Отмена</button>
      <button type="button" :disabled="saving || !text.trim()" @click="save">Сохранить</button>
    </div>
  </div>
</template>
