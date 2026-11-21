<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { Badge, IconButton } from '@voiceroom/ui-kit/components';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { RefreshStatus } from '../frame.ts';

defineProps<{ status: RefreshStatus }>();
const now = ref(Date.now());
let timer: number;
onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));

function formatEvery(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds === 60) return 'каждую минуту';
  if (seconds % 60 === 0) return 'каждые ' + String(seconds / 60) + ' мин';
  return 'каждые ' + String(seconds) + ' с';
}

function formatFresh(at: number): string {
  const seconds = Math.max(0, Math.floor((now.value - at) / 1000));
  if (seconds < 1) return 'только что';
  if (seconds < 60) return String(seconds) + ' с назад';
  return String(Math.floor(seconds / 60)) + ' мин назад';
}
</script>

<template>
  <div class="admin-freshness">
    <div class="admin-freshness__status">
      <Badge variant="dot" size="sm" aria-hidden="true" />
      <span class="admin-freshness__ago">
        {{ status.at === null ? 'Загружаем…' : 'Обновлено ' + formatFresh(status.at) }}
      </span>
      <span class="admin-freshness__every"
        >· {{ status.what ? status.what + ' ' : '' }}{{ formatEvery(status.everyMs) }}</span
      >
    </div>
    <IconButton
      label="Обновить"
      :size="32"
      class="admin-freshness__reload"
      :aria-busy="status.busy"
      @click="status.reload()"
      ><RefreshCw aria-hidden="true"
    /></IconButton>
  </div>
</template>
