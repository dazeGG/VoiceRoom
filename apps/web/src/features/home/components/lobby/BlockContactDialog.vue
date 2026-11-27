<script setup lang="ts">
import { Button, Dialog } from '@voiceroom/ui-kit/components';
import type { PublicUser } from '@/api/friends';
import { t } from '@/shared/i18n';
import { displayNameOf } from '@/shared/utils/display-name';

defineProps<{ user: PublicUser }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <Dialog
    open
    :title="t('Заблокировать {p0}?', { p0: displayNameOf(user) })"
    :on-close="() => emit('close')"
    initial-focus="[data-friend-block-cancel]"
  >
    <p>{{ t('Пользователь больше не сможет писать вам и звать в комнаты. Дружба будет разорвана.') }}</p>
    <template #footer>
      <Button variant="ghost" type="button" data-friend-block-cancel @click="emit('close')">{{ t('Отмена') }}</Button>
      <Button variant="danger" type="button" @click="emit('confirm')">{{ t('Заблокировать') }}</Button>
    </template>
  </Dialog>
</template>
