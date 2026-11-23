<script setup lang="ts">
import { Button, Callout } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { computed } from 'vue';
import { useAppUpdateStore } from './app-update.store';

defineProps<{ inCall: boolean }>();

const update = useAppUpdateStore();

const title = computed(() => (update.pending === 'app' ? t('Новая версия приложения') : t('Доступно обновление')));
const action = computed(() => (update.pending === 'app' ? t('Перезапустить') : t('Обновить')));
</script>

<template>
  <Callout
    v-if="update.pending !== 'none'"
    class="app-update"
    layout="pill"
    tone="accent"
    :title="title"
    :text="inCall ? t('после звонка') : undefined"
    role="status"
  >
    <template v-if="!inCall" #actions>
      <Button variant="primary" size="xs" pill :disabled="update.applying" @click="update.apply()">{{ action }}</Button>
    </template>
  </Callout>
</template>
