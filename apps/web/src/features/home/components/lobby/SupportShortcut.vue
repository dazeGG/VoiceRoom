<script setup lang="ts">
import { MessageSquare } from '@lucide/vue';
import { isOfficialAccount, OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { Button, Card, IconButton } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { useLobby } from '../../model/lobby-context';

defineProps<{ userId: string; compact?: boolean }>();
const lobby = useLobby();

function openSupport(): void {
  void lobby.openDm(OFFICIAL_ACCOUNT_ID);
}
</script>

<template>
  <template v-if="!isOfficialAccount({ id: userId })">
    <IconButton v-if="compact" :label="t('Как вам VoiceRoom?')" :size="40" variant="soft" @click="openSupport">
      <MessageSquare aria-hidden="true" />
    </IconButton>
    <Card v-else class="sidebar__support">
      <h3>{{ t('Как вам VoiceRoom?') }}</h3>
      <p>{{ t('Расскажите, что улучшить или чего не хватает. Если что-то работает не так, тоже пишите.') }}</p>
      <Button variant="soft" size="sm" @click="openSupport">{{ t('Написать нам') }}</Button>
    </Card>
  </template>
</template>
