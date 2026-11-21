<script setup lang="ts">
import { Button, Callout, Dialog } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';

defineProps<{ open: boolean }>();

const emit = defineEmits<{ register: []; continue: []; close: [] }>();
</script>

<template>
  <Dialog
    :open="open"
    :title="t('Снова нужна комната?')"
    :on-close="() => emit('close')"
    size="sm"
    initial-focus=".permanent-room-offer__register"
  >
    <Callout
      tone="accent"
      :title="t('Постоянная комната')"
      :text="
        t(
          'Гостевая комната удаляется, когда все выходят, поэтому ссылку приходится каждый раз отправлять заново. С аккаунтом комната постоянная: одна ссылка навсегда, а друзья заходят по ней без регистрации.'
        )
      "
    >
      <template #actions>
        <Button
          class="permanent-room-offer__register"
          variant="primary"
          size="sm"
          type="button"
          @click="emit('register')"
        >
          {{ t('Создать аккаунт') }}
        </Button>
        <Button variant="ghost" size="sm" type="button" @click="emit('continue')">{{
          t('Продолжить без аккаунта')
        }}</Button>
      </template>
    </Callout>
  </Dialog>
</template>
