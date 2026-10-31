<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useVoiceSessionStore } from '../voice-session.store';

const props = withDefaults(defineProps<{ variant?: 'sidebar' | 'topbar' | 'bubble'; separator?: boolean }>(), {
  variant: 'topbar',
  separator: false
});

const voiceSession = useVoiceSessionStore();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => clearInterval(timer));

function formatElapsed(since: number | null): string {
  if (!since) return '';
  const total = Math.max(0, Math.floor((now.value - since) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

const elapsed = computed(() => formatElapsed(voiceSession.roomActiveSince));
</script>

<template>
  <template v-if="elapsed">
    <span v-if="props.separator" class="room-call-timer__separator" aria-hidden="true">·</span>
    <span
      :class="['room-call-timer', `room-call-timer--${props.variant}`]"
      title="Длительность звонка в комнате"
      :aria-label="`Длительность звонка ${elapsed}`"
      >{{ elapsed }}</span
    >
  </template>
</template>
