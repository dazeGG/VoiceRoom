<script setup lang="ts">
import {
  Tooltip,
  IconButton,
  Avatar,
  Badge,
  Pressable,
  formatCallClock,
  useCallClock
} from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from '@lucide/vue';
import { computed, useId } from 'vue';
import RoomCallTimer from '@/features/room/components/RoomCallTimer.vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import type { ActiveVoice } from '../../model/active-voice';

const props = defineProps<{ voice: ActiveVoice }>();

const statusId = useId();
const openLabel = computed(() =>
  props.voice.friendCall
    ? t('Вернуться в звонок')
    : t('Открыть комнату {p0}', { p0: props.voice.roomName || t('активного голоса') })
);
const elapsed = useCallClock(() => props.voice.friendCall?.since, 'since');
const status = computed(() => {
  switch (props.voice.friendCall?.status) {
    case 'ringing':
      return t('Звоним…');
    case 'connected':
      return t('В звонке');
    case 'waiting':
      return t('Вы одни в звонке');
    default:
      return t('Подключаемся…');
  }
});
</script>

<template>
  <section class="voice-call-widget" :aria-label="voice.friendCall ? t('Активный звонок') : t('Активный голос')">
    <Tooltip :text="openLabel"
      ><Pressable
        class="voice-call-widget__head"
        :aria-label="openLabel"
        :aria-describedby="voice.friendCall ? statusId : undefined"
        @click="voice.open"
      >
        <Avatar
          :name="voice.roomName"
          :src="voice.avatarUrl"
          :shape="voice.friendCall ? 'circle' : 'squircle'"
          :color-key="voice.friendCall?.avatarColorKey"
          :background="voice.friendCall ? voice.friendCall.avatarAccent || undefined : 'var(--vr-surface-3)'"
          :foreground="voice.friendCall ? undefined : 'var(--vr-text)'"
          :size="40" />
        <span class="voice-call-widget__head-body">
          <span class="voice-call-widget__room-name" :title="voice.roomName"><EmojiText :text="voice.roomName" /></span>
          <span v-if="voice.friendCall" :id="statusId" class="voice-call-widget__status">
            <Badge variant="dot" tone="online" />
            <span>{{ status }}</span>
            <span aria-hidden="true">·</span>
            <span class="voice-call-widget__clock" role="timer" aria-live="off">{{
              formatCallClock(Math.floor(elapsed / 1000), true)
            }}</span>
          </span>
          <span v-else class="voice-call-widget__status">
            <span class="voice-call-widget__live-dot"></span>
            <span class="voice-call-widget__live-label">{{ t('Подключено') }}</span>
            <RoomCallTimer variant="sidebar" separator /> </span></span></Pressable
    ></Tooltip>

    <div class="voice-call-widget__actions">
      <IconButton
        class="voice-call-widget__button"
        :label="voice.muted ? t('Включить микрофон') : t('Выключить микрофон')"
        :aria-pressed="voice.muted"
        :size="40"
        variant="filled"
        :disabled="voice.friendCall?.controlsReady === false"
        @click="voice.toggleMic"
      >
        <MicOff v-if="voice.muted" aria-hidden="true" />
        <Mic v-else aria-hidden="true" />
      </IconButton>

      <IconButton
        class="voice-call-widget__button"
        :label="voice.deafened ? t('Включить звук') : t('Заглушить звук')"
        :aria-pressed="voice.deafened"
        :size="40"
        variant="filled"
        :disabled="voice.friendCall?.controlsReady === false"
        @click="voice.toggleDeafen"
      >
        <HeadphoneOff v-if="voice.deafened" aria-hidden="true" />
        <Headphones v-else aria-hidden="true" />
      </IconButton>

      <IconButton
        class="voice-call-widget__button"
        :label="voice.friendCall ? t('Завершить') : t('Выйти из голосовой комнаты')"
        :size="40"
        variant="danger-solid"
        @click="voice.leave"
      >
        <PhoneOff aria-hidden="true" />
      </IconButton>
    </div>
  </section>
</template>
