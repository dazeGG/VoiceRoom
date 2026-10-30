<script setup lang="ts">
import { computed } from 'vue';
import { useAppUpdateStore } from './app-update.store';

defineProps<{ inCall: boolean }>();

const update = useAppUpdateStore();

const title = computed(() => (update.pending === 'app' ? 'Новая версия приложения' : 'Доступно обновление'));
const action = computed(() => (update.pending === 'app' ? 'Перезапустить' : 'Обновить'));
</script>

<template>
  <div v-if="update.pending !== 'none'" class="app-update" role="status" aria-live="polite">
    <span class="app-update__dot" aria-hidden="true"></span>
    <span class="app-update__title">{{ title }}</span>
    <span v-if="inCall" class="app-update__note">после звонка</span>
    <button v-else class="app-update__action" type="button" :disabled="update.applying" @click="update.apply()">
      {{ action }}
    </button>
  </div>
</template>
