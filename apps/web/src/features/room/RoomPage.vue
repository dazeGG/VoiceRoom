<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { applyDesktopBoundaryToDocument, setRoomRouteActive } from '@/platform/desktop-boundary';
import { setRoomEmbedded, setRoomShell } from './client/core/embed';
import { STANDALONE_ROOM_SHELL, useRoomShell } from './shell';
import LeaveScreen from './components/LeaveScreen.vue';
import MobileCallStage from './components/MobileCallStage.vue';
import NotFoundScreen from './components/NotFoundScreen.vue';
import RoomCtaSlot from './components/RoomCtaSlot.vue';
import RoomEntryErrorScreen from './components/RoomEntryErrorScreen.vue';
import RoomModerationScreen from './components/RoomModerationScreen.vue';
import RoomOverlays from './components/RoomOverlays.vue';
import RoomSettingsDialog from './components/RoomSettingsDialog.vue';
import RoomStage from './components/RoomStage.vue';
import RoomTopbar from './components/RoomTopbar.vue';
import StartRoomScreen from './components/StartRoomScreen.vue';

const props = withDefaults(defineProps<{ embeddedRoomId?: string; roomId?: string; autoJoin?: boolean }>(), {
  embeddedRoomId: '',
  roomId: '',
  autoJoin: false
});

const roomRoot = ref<HTMLElement>();
const embedded = computed(() => Boolean(props.embeddedRoomId));
const shell = useRoomShell();

let cleanup: (() => void) | undefined;
let mountedClient = false;

onMounted(() => {
  const policy = applyDesktopBoundaryToDocument();
  if (!policy.roomClientAllowed) return;

  mountedClient = true;
  // Before the client loads: on a phone it opens the realtime socket only
  // while this page is marked active.
  setRoomRouteActive(true);
  setRoomEmbedded(Boolean(props.embeddedRoomId));
  setRoomShell(shell);

  void import('./client/main').then(({ mountRoomClient }) => {
    if (!mountedClient || !roomRoot.value) return;
    cleanup = mountRoomClient(roomRoot.value, {
      roomId: props.embeddedRoomId || props.roomId,
      embeddedRoomId: props.embeddedRoomId,
      autoJoin: props.autoJoin
    });
  });
});

onBeforeUnmount(() => {
  if (!mountedClient) return;
  mountedClient = false;
  cleanup?.();
  setRoomEmbedded(false);
  setRoomShell(STANDALONE_ROOM_SHELL);
  setRoomRouteActive(false);
});
</script>

<template>
  <div ref="roomRoot" :class="['app-shell', { 'room-embedded-shell': embedded }]">
    <RoomTopbar />
    <RoomCtaSlot />
    <StartRoomScreen />
    <RoomStage />
    <MobileCallStage />
    <RoomEntryErrorScreen />
    <RoomModerationScreen />
    <NotFoundScreen />
    <RoomOverlays />
    <RoomSettingsDialog />
    <LeaveScreen />
  </div>
</template>
