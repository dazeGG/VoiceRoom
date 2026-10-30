<script setup lang="ts">
import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from '@lucide/vue';
import { computed } from 'vue';
import RoomCallTimer from '@/features/room/components/RoomCallTimer.vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Avatar } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import type { ActiveVoice } from '../../model/active-voice';

const props = defineProps<{ voice: ActiveVoice }>();

const openLabel = computed(() => `Открыть комнату ${props.voice.roomName || 'активного голоса'}`);
</script>

<template>
  <div class="voice-call-widget" aria-label="Активный голос">
    <button
      class="voice-call-widget__head"
      type="button"
      :aria-label="openLabel"
      :title="openLabel"
      @click="voice.open"
    >
      <Avatar
        :name="voice.roomName"
        :src="voice.avatarUrl"
        shape="squircle"
        background="var(--vr-surface-3)"
        foreground="var(--vr-text)"
        :size="38"
      />
      <div class="voice-call-widget__head-body">
        <div class="voice-call-widget__room-name" :title="voice.roomName"><EmojiText :text="voice.roomName" /></div>
        <div class="voice-call-widget__status">
          <span class="voice-call-widget__live-dot"></span>
          <span class="voice-call-widget__live-label">Подключено</span>
          <RoomCallTimer variant="sidebar" separator />
        </div>
      </div>
    </button>

    <div class="voice-call-widget__actions">
      <button
        class="voice-call-widget__button"
        type="button"
        :title="voice.muted ? 'Включить микрофон' : 'Выключить микрофон'"
        :aria-label="voice.muted ? 'Включить микрофон' : 'Выключить микрофон'"
        :aria-pressed="voice.muted"
        @click="voice.toggleMic"
      >
        <MicOff v-if="voice.muted" v-bind="iconMd" aria-hidden="true" />
        <Mic v-else v-bind="iconMd" aria-hidden="true" />
      </button>

      <button
        class="voice-call-widget__button"
        type="button"
        :title="voice.deafened ? 'Включить звук' : 'Заглушить звук'"
        :aria-label="voice.deafened ? 'Включить звук' : 'Заглушить звук'"
        :aria-pressed="voice.deafened"
        @click="voice.toggleDeafen"
      >
        <HeadphoneOff v-if="voice.deafened" v-bind="iconMd" aria-hidden="true" />
        <Headphones v-else v-bind="iconMd" aria-hidden="true" />
      </button>

      <button
        class="voice-call-widget__button voice-call-widget__button--leave"
        type="button"
        title="Выйти"
        aria-label="Выйти из голосовой комнаты"
        @click="voice.leave"
      >
        <PhoneOff v-bind="iconMd" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
