<script setup lang="ts">
import { Tooltip, IconButton, Avatar, Pressable } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from '@lucide/vue';
import { computed } from 'vue';
import RoomCallTimer from '@/features/room/components/RoomCallTimer.vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import type { ActiveVoice } from '../../model/active-voice';

const props = defineProps<{ voice: ActiveVoice }>();

const openLabel = computed(() => t('Открыть комнату {p0}', { p0: props.voice.roomName || t('активного голоса') }));
</script>

<template>
  <div class="voice-call-widget" :aria-label="t('Активный голос')">
    <Tooltip :text="openLabel"
      ><Pressable class="voice-call-widget__head" :aria-label="openLabel" @click="voice.open">
        <Avatar
          :name="voice.roomName"
          :src="voice.avatarUrl"
          shape="squircle"
          background="var(--vr-surface-3)"
          foreground="var(--vr-text)"
          :size="40" />
        <div class="voice-call-widget__head-body">
          <div class="voice-call-widget__room-name" :title="voice.roomName"><EmojiText :text="voice.roomName" /></div>
          <div class="voice-call-widget__status">
            <span class="voice-call-widget__live-dot"></span>
            <span class="voice-call-widget__live-label">{{ t('Подключено') }}</span>
            <RoomCallTimer variant="sidebar" separator />
          </div></div></Pressable
    ></Tooltip>

    <div class="voice-call-widget__actions">
      <IconButton
        class="voice-call-widget__button"
        :label="voice.muted ? t('Включить микрофон') : t('Выключить микрофон')"
        :aria-pressed="voice.muted"
        :size="40"
        variant="filled"
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
        @click="voice.toggleDeafen"
      >
        <HeadphoneOff v-if="voice.deafened" aria-hidden="true" />
        <Headphones v-else aria-hidden="true" />
      </IconButton>

      <IconButton
        class="voice-call-widget__button voice-call-widget__button--leave"
        :label="t('Выйти из голосовой комнаты')"
        :size="40"
        variant="filled"
        @click="voice.leave"
      >
        <PhoneOff aria-hidden="true" />
      </IconButton>
    </div>
  </div>
</template>
