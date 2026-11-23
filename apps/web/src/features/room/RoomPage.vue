<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { applyDesktopBoundaryToDocument, setRoomRouteActive } from '@/platform/desktop-boundary';
import { useRoomShell } from './shell';
import { getMissingRoomLabel } from './adapters/web-peer-session';
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

  void import('@voiceroom/call/engine/main').then(({ mountRoomClient }) => {
    if (!mountedClient || !roomRoot.value) return;
    cleanup = mountRoomClient(roomRoot.value, {
      roomId: props.embeddedRoomId || props.roomId,
      roomRoute: Boolean(props.embeddedRoomId) || window.location.pathname.startsWith('/r/'),
      missingRoomLabel: getMissingRoomLabel(),
      embedded: Boolean(props.embeddedRoomId),
      shell,
      autoJoin: props.autoJoin
    });
  });
});

onBeforeUnmount(() => {
  if (!mountedClient) return;
  mountedClient = false;
  cleanup?.();
  setRoomRouteActive(false);
});
</script>

<template>
  <div ref="roomRoot" :class="['app-shell', { 'room-embedded-shell': embedded }]">
    <RoomTopbar :language-in-settings="embedded" />
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
