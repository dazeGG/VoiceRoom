<script setup lang="ts">
import { Button, Dialog } from '@/shared/ui';

defineProps<{ open: boolean }>();

const emit = defineEmits<{ register: []; continue: []; close: [] }>();
</script>

<template>
  <Dialog
    :open="open"
    title="Снова нужна комната?"
    :on-close="() => emit('close')"
    :width="430"
    initial-focus=".permanent-room-offer__register"
  >
    <p class="permanent-room-offer__text">
      Гостевая комната удаляется, когда все выходят, поэтому ссылку приходится каждый раз отправлять заново. С аккаунтом
      комната постоянная: одна ссылка навсегда, а друзья заходят по ней без регистрации.
    </p>
    <div class="permanent-room-offer__actions">
      <Button class="permanent-room-offer__register" variant="primary" type="button" @click="emit('register')">
        Создать аккаунт
      </Button>
      <Button variant="ghost" type="button" @click="emit('continue')">Продолжить без аккаунта</Button>
    </div>
  </Dialog>
</template>
