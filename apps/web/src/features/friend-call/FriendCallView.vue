<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { ChevronLeft, MessageSquare, Mic, MicOff, Phone, PhoneOff } from '@lucide/vue';
import { Avatar, Button, Callout, IconButton, formatCallClock, useCallClock } from '@voiceroom/ui-kit/components';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import { useScreenUiStore } from '@voiceroom/call/engine/core/screen-ui.store';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { isMicrophoneShownMuted } from '@voiceroom/call/engine/core/microphone-mute';
import { closeScreenView } from '@voiceroom/call/engine/ui/screen-view';
import { syncRemoteCameraDemand } from '@voiceroom/call/engine/services/livekit/remote-participants';
import type { CallSnapshot } from '@voiceroom/shared/contracts/rings';
import RoomDock from '@/features/room/components/RoomDock.vue';
import MobileCallTopbar from '@/features/room/components/MobileCallTopbar.vue';
import ScreenStage from '@/features/room/components/ScreenStage.vue';
import { usePortraitCallLayout } from '@/features/room/mobile-call-layout';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { t } from '@/shared/i18n';
import FriendCallTiles from './FriendCallTiles.vue';
import { callPeer, useFriendCallStore } from './friend-call.store';

const { call, offset } = defineProps<{ call: CallSnapshot; offset: number }>();
const emit = defineEmits<{ back: []; messages: [peerId: string] }>();
const calls = useFriendCallStore();
const portrait = usePortraitCallLayout();
const voice = useVoiceSessionStore();
const screen = useScreenUiStore();
const peer = computed(() => callPeer(call, calls.userId));
const self = computed(() => (call.caller.id === calls.userId ? call.caller : call.recipient));
const peerSeat = computed(() => call.seats?.find((seat) => seat.userId === peer.value.id));
const peerStatus = computed(() => peerSeat.value?.status ?? 'absent');
const ringingClock = useCallClock(
  () => (call.phase === 'ringing' ? call.ringingExpiresAt + offset : undefined),
  'until'
);
const startedClock = useCallClock(() => (call.firstConnectedAt ?? call.startedAt) + offset, 'since');
const clock = computed(() => formatCallClock(Math.floor(startedClock.value / 1000), true));
const ringing = computed(() => call.phase === 'ringing' && ringingClock.value > 0);
const declined = computed(() => call.phase === 'closed' && call.endReason === 'declined');
const noAnswer = computed(() => call.attemptResult === 'no_answer' || (call.phase === 'ringing' && !ringing.value));
const deadline = computed(() =>
  !ringing.value && !declined.value && call.aloneDeadline !== null ? call.aloneDeadline + offset : undefined
);
const muted = computed(() => isMicrophoneShownMuted() || !state.localStream);
const hasEngine = computed(() => Boolean(calls.voice?.callId === call.id && voice.roomId === calls.voice.roomId));
const showElapsed = computed(
  () =>
    !ringing.value && !declined.value && !noAnswer.value && (call.firstConnectedAt !== null || call.phase === 'alone')
);
const subtitle = computed(() => {
  if (declined.value) return t('Звонок отклонён');
  if (ringing.value) return t('Звоним…');
  if (noAnswer.value) return t('Нет ответа');
  return showElapsed.value ? t('Звонок · {time}', { time: clock.value }) : t('Подключаемся…');
});
const showPlaceholder = computed(() => ringing.value || declined.value || (noAnswer.value && !call.firstConnectedAt));
const canRingAgain = computed(() => call.allowedActions.includes('re-ring'));

watchEffect(() => {
  if (hasEngine.value) void syncRemoteCameraDemand();
});
onBeforeUnmount(() => {
  if (screen.stageVisible) closeScreenView();
});
</script>

<template>
  <section
    class="friend-call"
    :class="{ 'friend-call--portrait': portrait }"
    :aria-label="t('Звонок: {name}', { name: peer.displayName })"
  >
    <MobileCallTopbar
      v-if="portrait"
      :friend-call="{ peer, subtitle, timed: showElapsed }"
      @back="emit('back')"
      @messages="emit('messages', peer.id)"
    />
    <header v-else class="friend-call__header">
      <IconButton :label="t('Назад')" :size="40" @click="emit('back')"><ChevronLeft aria-hidden="true" /></IconButton>
      <Avatar
        :name="peer.displayName"
        :src="peer.avatarUrl"
        :color-key="peer.avatarColorKey"
        :background="peer.avatarAccent || undefined"
        :size="40"
      />
      <div class="friend-call__heading">
        <h1><EmojiText :text="peer.displayName" /></h1>
        <p :role="showElapsed ? 'timer' : undefined">
          {{ subtitle }}
        </p>
      </div>
      <IconButton :label="t('Открыть личные сообщения')" :size="40" @click="emit('messages', peer.id)">
        <MessageSquare aria-hidden="true" />
      </IconButton>
    </header>

    <div class="friend-call__stage">
      <div v-if="showPlaceholder" class="friend-call__placeholder">
        <Avatar
          :name="peer.displayName"
          :src="peer.avatarUrl"
          :color-key="peer.avatarColorKey"
          :background="peer.avatarAccent || undefined"
          :size="128"
          :ringing="ringing ? 'ringing' : undefined"
        />
        <p class="friend-call__name"><EmojiText :text="peer.displayName" /></p>
        <div role="status">
          <p v-if="declined">{{ t('Звонок отклонён') }}</p>
          <p v-else-if="ringing">{{ t('Звоним…') }}</p>
          <p v-else>{{ t('{name} не отвечает', { name: peer.displayName }) }}</p>
        </div>
        <p v-if="declined">{{ t('Возвращаемся в личные сообщения…') }}</p>
        <p v-else-if="ringing" class="friend-call__mic-note">
          <MicOff v-if="muted" aria-hidden="true" /><Mic v-else aria-hidden="true" />
          {{
            muted
              ? t('Микрофон выключен: включите его, чтобы вас услышали')
              : t('Микрофон включён: вас услышат сразу после ответа')
          }}
        </p>
      </div>
      <Callout
        v-if="deadline !== undefined"
        class="friend-call__countdown"
        layout="countdown"
        :deadline="deadline"
        :title="noAnswer ? '' : t('{name} покидает звонок', { name: peer.displayName })"
        :text="noAnswer ? t('Можно позвонить ещё раз или завершить звонок.') : undefined"
      >
        <template v-if="canRingAgain && !portrait" #actions>
          <Button variant="primary" size="sm" :disabled="Boolean(calls.busy)" @click="void calls.act(call, 're-ring')">
            {{ t('Позвонить снова') }}
          </Button>
        </template>
      </Callout>
      <Button
        v-if="portrait && deadline !== undefined && canRingAgain"
        variant="primary"
        size="lg"
        fill
        :disabled="Boolean(calls.busy)"
        @click="void calls.act(call, 're-ring')"
      >
        <template #icon><Phone aria-hidden="true" /></template>
        {{ t('Позвонить снова') }}
      </Button>
      <template v-if="!showPlaceholder">
        <ScreenStage v-if="hasEngine" />
        <FriendCallTiles :peer="peer" :self="self" :peer-status="peerStatus" :has-engine="hasEngine" />
      </template>
    </div>

    <div v-if="!declined" class="friend-call__dock">
      <RoomDock
        v-if="hasEngine"
        :friend-call="{ groupLabel: t('Управление звонком'), leaveLabel: t('Завершить'), leave: calls.leave }"
      />
      <div v-else class="friend-call__pending-dock">
        <IconButton :label="t('Завершить')" variant="danger-solid" :size="44" @click="void calls.leave()">
          <PhoneOff aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  </section>
</template>
