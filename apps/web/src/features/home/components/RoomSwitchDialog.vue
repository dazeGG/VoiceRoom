<script setup lang="ts">
import { ref, watch } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Button, Dialog } from '@/shared/ui';

const props = defineProps<{ open: boolean; fromName: string; toName: string }>();

const emit = defineEmits<{ confirm: [dontAskAgain: boolean]; cancel: [] }>();

const dontAskAgain = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) dontAskAgain.value = false;
  },
  { immediate: true }
);
</script>

<template>
  <Dialog :open="open" :title="`Перейти в комнату «${toName}»?`" :on-close="() => emit('cancel')" :width="430">
    <p class="room-switch__text">Вы покинете звонок в «<EmojiText :text="fromName" />».</p>
    <label class="room-switch__remember">
      <input v-model="dontAskAgain" type="checkbox" />
      <span>Больше не спрашивать</span>
    </label>
    <div class="home-dialog__actions">
      <Button variant="ghost" type="button" @click="emit('cancel')">Отмена</Button>
      <Button variant="primary" type="button" @click="emit('confirm', dontAskAgain)">Перейти</Button>
    </div>
  </Dialog>
</template>
