<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { Maximize2, Minimize2, Mic, MicOff, Phone, PhoneOff } from '@lucide/vue';
import { Avatar, Button, Callout, IconButton } from '@voiceroom/ui-kit/components';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import { useScreenUiStore } from '@voiceroom/call/engine/core/screen-ui.store';
import { useRoomDeviceUiStore } from '@voiceroom/call/engine/core/room-device-ui.store';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { isMicrophoneShownMuted } from '@voiceroom/call/engine/core/microphone-mute';
import { closeScreenView } from '@voiceroom/call/engine/ui/screen-view';
import { syncRemoteCameraDemand } from '@voiceroom/call/engine/services/livekit/remote-participants';
import type { CallSnapshot } from '@voiceroom/shared/contracts/rings';
import RoomDock from '@/features/room/components/RoomDock.vue';
import MobileCallTopbar from '@/features/room/components/MobileCallTopbar.vue';
import ScreenStage from '@/features/room/components/ScreenStage.vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { t } from '@/shared/i18n';
import FriendCallTiles from './FriendCallTiles.vue';
import FriendCallSecurity from './FriendCallSecurity.vue';
import type { FriendCallStatus } from './use-friend-call-status';
import { callPeer, useFriendCallStore } from './friend-call.store';

const { call, status, portrait, expanded } = defineProps<{
  call: CallSnapshot;
  status: FriendCallStatus;
  portrait?: boolean;
  expanded?: boolean;
}>();
const emit = defineEmits<{ back: []; messages: []; toggleExpanded: [] }>();
const calls = useFriendCallStore();
const voice = useVoiceSessionStore();
const screen = useScreenUiStore();
const devices = useRoomDeviceUiStore();
const peer = computed(() => callPeer(call, calls.userId));
const self = computed(() => (call.caller.id === calls.userId ? call.caller : call.recipient));
const peerSeat = computed(() => call.seats?.find((seat) => seat.userId === peer.value.id));
const peerStatus = computed(() => peerSeat.value?.status ?? 'absent');
const muted = computed(() => isMicrophoneShownMuted() || !state.localStream);
const hasEngine = computed(() => Boolean(calls.voice?.callId === call.id && voice.roomId === calls.voice.roomId));
const showPlaceholder = computed(
  () => status.declined || status.ringing || (status.noAnswer && call.firstConnectedAt === null)
);
const canRingAgain = computed(() => call.allowedActions.includes('re-ring'));
// On a desktop call the dock steps aside until the pointer or keyboard focus enters the call; the styles
// own the reveal. It stays put while a device menu is open, before the call connects, and over a countdown.
const dockAutoHides = computed(
  () =>
    !portrait &&
    hasEngine.value &&
    !showPlaceholder.value &&
    status.deadline === undefined &&
    !devices.devicePopoverOpen &&
    !devices.outputPopoverOpen &&
    !devices.cameraPopoverOpen
);

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
    :class="{ 'friend-call--portrait': portrait, 'friend-call--dock-autohide': dockAutoHides }"
    :aria-label="t('Звонок: {name}', { name: peer.displayName })"
  >
    <MobileCallTopbar
      v-if="portrait"
      :friend-call="{ peer, subtitle: status.subtitle, timed: status.timed }"
      @back="emit('back')"
      @messages="emit('messages')"
    />
    <div v-else-if="!status.declined" class="friend-call__expand">
      <IconButton :label="expanded ? t('Свернуть') : t('Развернуть')" :size="40" @click="emit('toggleExpanded')">
        <Minimize2 v-if="expanded" aria-hidden="true" />
        <Maximize2 v-else aria-hidden="true" />
      </IconButton>
    </div>

    <FriendCallSecurity v-if="hasEngine && !status.declined" :peer-present="peerStatus === 'present'" />

    <div class="friend-call__stage">
      <Callout
        v-if="hasEngine && state.callE2ee?.phase === 'failed'"
        class="friend-call__countdown"
        tone="danger"
        :title="t('Не удалось установить защищённое соединение')"
        :text="t('Без шифрования звонок не идёт. Завершите его и позвоните снова.')"
      />
      <div v-if="showPlaceholder" class="friend-call__placeholder">
        <Avatar
          :name="peer.displayName"
          :src="peer.avatarUrl"
          :color-key="peer.avatarColorKey"
          :background="peer.avatarAccent || undefined"
          :size="portrait ? 128 : 64"
          :ringing="status.ringing ? 'ringing' : undefined"
        />
        <p class="friend-call__name"><EmojiText :text="peer.displayName" /></p>
        <div role="status">
          <p v-if="status.declined || status.ringing">{{ status.subtitle }}</p>
          <p v-else>{{ t('{name} не отвечает', { name: peer.displayName }) }}</p>
        </div>
        <p v-if="status.ringing" class="friend-call__mic-note">
          <MicOff v-if="muted" aria-hidden="true" /><Mic v-else aria-hidden="true" />
          {{
            muted
              ? t('Микрофон выключен: включите его, чтобы вас услышали')
              : t('Микрофон включён: вас услышат сразу после ответа')
          }}
        </p>
      </div>
      <Callout
        v-if="status.deadline !== undefined"
        class="friend-call__countdown"
        layout="countdown"
        :deadline="status.deadline"
        :title="status.noAnswer ? '' : t('{name} покидает звонок', { name: peer.displayName })"
        :text="status.noAnswer ? t('Можно позвонить ещё раз или завершить звонок.') : undefined"
      >
        <template v-if="canRingAgain && !portrait" #actions>
          <Button variant="primary" size="sm" :disabled="Boolean(calls.busy)" @click="void calls.act(call, 're-ring')">
            {{ t('Позвонить снова') }}
          </Button>
        </template>
      </Callout>
      <Button
        v-if="portrait && status.deadline !== undefined && canRingAgain"
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
        <div v-if="hasEngine" v-show="screen.stageVisible" class="friend-call__screen">
          <ScreenStage />
        </div>
        <FriendCallTiles :peer="peer" :self="self" :peer-status="peerStatus" :has-engine="hasEngine" />
      </template>
    </div>

    <div v-if="!status.declined" class="friend-call__dock">
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
