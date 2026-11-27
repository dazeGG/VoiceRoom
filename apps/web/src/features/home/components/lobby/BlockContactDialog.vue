<script setup lang="ts">
import { AlertDialog, Card, Checkbox, ListItem } from '@voiceroom/ui-kit/components';
import type { CheckboxValue } from '@voiceroom/ui-kit/components';
import { ref } from 'vue';
import type { PublicUser } from '@/api/friends';
import { t } from '@/shared/i18n';
import { displayNameOf } from '@/shared/utils/display-name';

defineProps<{ user: PublicUser }>();
const emit = defineEmits<{ close: []; confirm: [deleteConversation: boolean] }>();
const deleteConversation = ref<CheckboxValue>(false);
</script>

<template>
  <AlertDialog
    open
    tone="danger"
    :title="t('Заблокировать пользователя?')"
    :description="t('Он не сможет писать, звонить и звать вас в комнаты. Если вы друзья, дружба будет разорвана.')"
    :confirm-label="deleteConversation === true ? t('Заблокировать и удалить') : t('Заблокировать')"
    @cancel="emit('close')"
    @confirm="emit('confirm', deleteConversation === true)"
  >
    <Card>
      <ListItem
        :text="displayNameOf(user)"
        :caption="`@${user.login}`"
        :avatar="{
          name: displayNameOf(user),
          src: user.avatarUrl,
          colorKey: user.avatarColorKey,
          background: user.avatarAccent || undefined
        }"
      />
    </Card>
    <Checkbox
      v-model="deleteConversation"
      :description="t('Сообщения и файлы исчезнут у вас и у @{login}. Отменить это нельзя.', { login: user.login })"
    >
      {{ t('Удалить переписку') }}
    </Checkbox>
    <small>{{ t('Разблокировать можно в «Настройки → Конфиденциальность».') }}</small>
  </AlertDialog>
</template>
