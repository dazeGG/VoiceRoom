<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watchEffect } from 'vue';
import { RoomStage, ParticipantTile, StageTiles } from '@voice-room/call/views';
import { useParticipantsUiStore } from '@voice-room/call/engine/core/participants-ui.store';
import { useScreenUiStore } from '@voice-room/call/engine/core/screen-ui.store';
import { useToastUiStore } from '@voice-room/call/engine/core/toast-ui.store';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { enterScreenView, leaveScreenView } from '@voice-room/call/engine/ui/screen-view';
import { syncRemoteCameraDemand } from '@voice-room/call/engine/services/livekit/remote-participants';
import type { RoomCapabilities } from '@voice-room/shared/contracts/rooms';
import { getAvatarPresentation } from '@voice-room/ui/avatar-presentation';
import { t } from '@voice-room/ui/i18n';
import MeetDock from '@/components/MeetDock.vue';
import MeetScreen from '@/components/MeetScreen.vue';

defineProps<{ capabilities: RoomCapabilities | null; reconnecting: boolean }>();
const emit = defineEmits<{ leave: [] }>();
const participantsUi = useParticipantsUiStore();
const screen = useScreenUiStore();
const toast = useToastUiStore();
const heading = useTemplateRef<HTMLHeadingElement>('heading');
const participants = computed(() => participantsUi.getSortedParticipants());
const focused = computed(() => participantsUi.getFocusedParticipant());

onMounted(() => heading.value?.focus());
watchEffect(() => syncRemoteCameraDemand(), { flush: 'post' });

async function focusParticipant(peerId: string): Promise<void> {
  if (state.viewedScreenPeerId) await leaveScreenView({ keepPreview: false });
  participantsUi.toggleParticipantFocus(peerId);
}

async function watchScreen(peerId: string): Promise<void> {
  try {
    await enterScreenView(peerId);
  } catch {
    toast.showToastUi(t('meet.error.screen'), { variant: 'error' });
  }
}
</script>

<template>
  <div class="meet-call" :class="{ 'meet-call--screen': screen.stageVisible }">
    <div class="meet-call__header">
      <h1 ref="heading" tabindex="-1">{{ t('meet.call') }}</h1>
      <span class="meet-call__connection" :class="{ 'meet-call__connection--waiting': reconnecting }" role="status">
        {{ t(reconnecting ? 'meet.reconnecting' : 'meet.connected') }}
      </span>
    </div>
    <RoomStage :hidden="false">
      <template #screen><MeetScreen /></template>
      <template #tiles>
        <StageTiles
          :participants="participants"
          :focused-participant="focused"
          :screen-focused="screen.stageVisible"
          :stream-count="0"
        >
          <template #participants="{ participants: tiles, variant }">
            <ParticipantTile
              v-for="participant in tiles"
              :key="participant.id"
              :participant="participant"
              :avatar="getAvatarPresentation(participant)"
              :variant="variant"
              :mirrored="participant.isLocal && state.cameraFacing !== 'environment'"
              :viewing="state.viewedScreenPeerId === participant.id || !capabilities?.screenShare"
              :screen-requesting="state.screenRequesting"
              @activate="focusParticipant(participant.id)"
              @watch-screen="watchScreen(participant.id)"
            />
          </template>
          <template #streams />
        </StageTiles>
      </template>
      <template #dock>
        <MeetDock :capabilities="capabilities" @leave="emit('leave')" />
      </template>
    </RoomStage>
    <div class="meet-call__toasts" aria-live="polite">
      <div v-for="item in toast.items" :key="item.id" class="meet-call__toast">
        <strong>{{ item.message }}</strong>
        <span v-if="item.description">{{ item.description }}</span>
        <button
          v-for="action in item.actions"
          :key="action.label"
          class="meet-button meet-button--secondary"
          type="button"
          @click="action.onClick(item.id)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </div>
</template>
