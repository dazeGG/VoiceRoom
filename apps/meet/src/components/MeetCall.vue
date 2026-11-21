<script setup lang="ts">
import { MessageSquareText } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watchEffect } from 'vue';
import { RoomStage, ParticipantTile, StageTiles } from '@voiceroom/call/views';
import { useParticipantsUiStore } from '@voiceroom/call/engine/core/participants-ui.store';
import { useScreenUiStore } from '@voiceroom/call/engine/core/screen-ui.store';
import { useToastUiStore } from '@voiceroom/call/engine/core/toast-ui.store';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { enterScreenView, leaveScreenView } from '@voiceroom/call/engine/ui/screen-view';
import { syncRemoteCameraDemand } from '@voiceroom/call/engine/services/livekit/remote-participants';
import type { RoomCapabilities } from '@voiceroom/shared/contracts/rooms';
import { getAvatarPresentation } from '@voiceroom/ui/avatar-presentation';
import { Button, Toast } from '@voiceroom/ui-kit/components';
import { t } from '@voiceroom/ui-kit/i18n';
import MeetChat from '@/components/MeetChat.vue';
import MeetDock from '@/components/MeetDock.vue';
import MeetScreen from '@/components/MeetScreen.vue';
import { useMeetStore } from '@/meet.store';

defineProps<{ capabilities: RoomCapabilities | null; reconnecting: boolean }>();
const emit = defineEmits<{ leave: [] }>();
const participantsUi = useParticipantsUiStore();
const screen = useScreenUiStore();
const toast = useToastUiStore();
toast.useViewportTimers();
const { chat } = useMeetStore().transport;
const chatOpen = ref(false);
const chatId = useId();
const heading = useTemplateRef<HTMLHeadingElement>('heading');
const participants = computed(() => participantsUi.getSortedParticipants());
const focused = computed(() => participantsUi.getFocusedParticipant());

onMounted(() => heading.value?.focus());
onBeforeUnmount(() => {
  toast.items = [];
  toast.useViewportTimers(false);
});
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
      <div class="meet-call__header-actions">
        <span class="meet-call__connection" :class="{ 'meet-call__connection--waiting': reconnecting }" role="status">
          {{ t(reconnecting ? 'meet.reconnecting' : 'meet.connected') }}
        </span>
        <Button
          v-if="capabilities?.chat === 'ephemeral'"
          class="meet-call__chat-toggle"
          variant="outline"
          size="lg"
          :aria-label="t('meet.chat.title')"
          aria-haspopup="dialog"
          :aria-controls="chatId"
          :aria-expanded="chatOpen"
          @click="chatOpen = !chatOpen"
        >
          <template #icon><MessageSquareText aria-hidden="true" /></template>
          <span class="meet-call__chat-label">{{ t('meet.chat.title') }}</span>
        </Button>
      </div>
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
      <template #panel>
        <MeetChat
          v-if="capabilities?.chat === 'ephemeral'"
          v-model="chatOpen"
          :panel-id="chatId"
          :local-peer-id="state.peerId"
          :chat="chat"
        />
      </template>
    </RoomStage>
    <Toast id="meet-toasts" :toasts="toast.items" :on-dismiss="toast.dismissToastUi" />
  </div>
</template>
