<script setup lang="ts">
import { Button, Callout, IconButton, NativeSelect, Slider } from '@voice-room/ui/components';
import { onMounted, onBeforeUnmount, ref, computed, useTemplateRef } from 'vue';
import { X } from '@lucide/vue';
import { WIDGET_SERVICE_URL, parseWidgetMessage, type WidgetBootstrap } from '@voice-room/shared/contracts/widget';
import { WidgetCallLayout, WidgetJoinControls } from '@voice-room/ui/widget';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { isMicrophoneShownMuted } from '@voice-room/call/engine/core/microphone-mute';
import { useRoomDeviceUiStore } from '@voice-room/call/engine/core/room-device-ui.store';
import { useToastUiStore } from '@voice-room/call/engine/core/toast-ui.store';
import {
  getParticipantAudioPreference,
  getParticipantAudioPreferenceKey,
  storeParticipantAudioPreference
} from '@voice-room/call/engine/core/settings';
import { switchCamera, toggleCamera } from '@voice-room/call/engine/services/camera-service';
import {
  applyRemoteParticipantAudioPreferences,
  setLocalAppAudioSuppressed,
  unlockAudio
} from '@voice-room/call/engine/services/media-playback-service';
import { toggleMicrophoneMuted } from '@voice-room/call/engine/ui/controls';
import {
  refreshDevices,
  switchMicrophone,
  switchNoiseMode,
  switchOutputDevice
} from '@voice-room/call/engine/ui/devices';
import { useWidgetSession } from './session';

const props = defineProps<{ bootstrap: WidgetBootstrap }>();
const session = useWidgetSession();
const { entry } = session;
const devices = useRoomDeviceUiStore();
const noiseOptions = [
  { value: 'rnnoise', label: 'RNNoise' },
  { value: 'browser', label: 'Браузерное' },
  { value: 'off', label: 'Выключено' }
];
const toast = useToastUiStore();
const notice = computed(() => toast.items.at(-1));
const shell = useTemplateRef<HTMLElement>('shell');
const code = ref('');
const expandable = ref(false);
const expanded = ref(false);
type Device = 'input' | 'output' | 'camera';
const panel = ref<Device | 'participant' | null>(null);
const panelLabels = {
  input: 'Настройки микрофона',
  output: 'Настройки динамика',
  camera: 'Настройки камеры'
};
const participantId = ref('');
const participantVolume = ref(1);
const participants = computed(() =>
  [...(state.self ? [state.self] : []), ...state.peers.values()].map((peer) => ({
    id: peer.id,
    name: peer.name || 'Гость',
    self: peer.isLocal,
    muted: peer.isLocal ? isMicrophoneShownMuted() || peer.serverMuted : peer.muted || peer.serverMuted,
    speaking: peer.speaking,
    cameraStream: entry.cameraAllowed && peer.camera ? peer.cameraStream : null
  }))
);
const selectedParticipant = computed(() => participants.value.find(({ id }) => id === participantId.value));
const visiblePanel = computed(() => {
  if (panel.value === 'participant' && !selectedParticipant.value) return null;
  if (panel.value === 'camera' && !entry.cameraAllowed) return null;
  return panel.value;
});
const panelTitle = computed(() => {
  const current = visiblePanel.value;
  if (current === 'participant') return selectedParticipant.value?.name;
  return current ? panelLabels[current] : '';
});
const outputBlocked = computed(() => state.voiceConnection === 'playback-blocked' || state.audioUnlockPending);
const style = computed(() => ({
  '--vr-bg': props.bootstrap.config.background,
  '--vr-text': props.bootstrap.config.text,
  '--vr-accent': props.bootstrap.config.accent,
  '--widget-radius': `${props.bootstrap.config.radius}px`,
  borderRadius: `${props.bootstrap.config.radius}px`
}));
const notify = (type: 'requestCollapse' | 'requestExpand', active?: boolean) =>
  window.parent.postMessage(
    { version: 1, nonce: props.bootstrap.nonce, type, ...(active === undefined ? {} : { active }) },
    props.bootstrap.parentOrigin
  );
function receiveExpansion(event: MessageEvent<unknown>) {
  if (event.source !== window.parent || event.origin !== props.bootstrap.parentOrigin) return;
  const message = parseWidgetMessage(event.data);
  if (message?.type !== 'expandState' || message.nonce !== props.bootstrap.nonce || typeof message.active !== 'boolean')
    return;
  expandable.value = true;
  expanded.value = message.active;
}
onMounted(() => window.addEventListener('message', receiveExpansion));
onBeforeUnmount(() => {
  window.removeEventListener('message', receiveExpansion);
  session.dispose();
});
async function run(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    session.report(error);
  }
}
function updateVolume(value: number) {
  const peer = state.peers.get(participantId.value);
  if (!peer) return;
  const preference = storeParticipantAudioPreference(getParticipantAudioPreferenceKey(peer.accountUserId, peer.id), {
    volume: Math.min(1, Math.max(0, value))
  });
  participantVolume.value = preference.volume;
  applyRemoteParticipantAudioPreferences(peer);
}
function togglePanel(next: Device) {
  panel.value = panel.value === next ? null : next;
  if (panel.value) void run(refreshDevices);
}
async function toggleOutput() {
  if (state.localAppAudioSuppressed || !outputBlocked.value) setLocalAppAudioSuppressed(!state.localAppAudioSuppressed);
  if (!state.localAppAudioSuppressed) await unlockAudio();
}
function toggleDevice(device: Device) {
  if (device === 'input') toggleMicrophoneMuted();
  else if (device === 'output') void run(toggleOutput);
  else if (entry.cameraAllowed) void run(toggleCamera);
}
function showParticipant(id: string) {
  panel.value = panel.value === 'participant' && participantId.value === id ? null : 'participant';
  participantId.value = id;
  const peer = state.peers.get(id);
  if (peer) {
    participantVolume.value = Math.min(
      1,
      getParticipantAudioPreference(getParticipantAudioPreferenceKey(peer.accountUserId, id)).volume
    );
  }
}
function enter(action: () => Promise<void>) {
  panel.value = null;
  return run(action);
}
function leave() {
  panel.value = null;
  session.leave();
}
</script>
<template>
  <main ref="shell" class="widget-shell" :class="{ 'widget-shell--call': entry.joined }" :style="style">
    <header v-if="bootstrap.config.mode === 'floating' && !entry.joined" class="widget-shell__header">
      <Button size="sm" variant="outline" @click="notify('requestCollapse')">Свернуть</Button>
    </header>
    <div class="widget-shell__body">
      <p v-if="!entry.joined" role="status" class="widget-shell__status">{{ entry.status }}</p>
      <Callout
        v-if="entry.error || notice"
        class="widget-shell__notice"
        role="alert"
        :tone="notice && notice.variant !== 'error' ? 'info' : 'danger'"
        :title="notice?.message || entry.error"
      />
      <WidgetJoinControls
        v-if="!entry.joined"
        v-model:name="entry.name"
        v-model:code="code"
        :title="bootstrap.config.title"
        @create="enter(session.create)"
        @join="enter(() => session.join(code))"
      />
      <WidgetCallLayout
        v-else
        :members="participants"
        :room-code="entry.roomId"
        :status="entry.status"
        :quality="state.localConnectionQuality"
        :muted="isMicrophoneShownMuted() || state.self?.serverMuted === true"
        :output-muted="state.localAppAudioSuppressed || outputBlocked"
        :camera="Boolean(state.localCameraStream)"
        :camera-allowed="entry.cameraAllowed"
        :expandable="expandable"
        :expanded="expanded"
        :floating="bootstrap.config.mode === 'floating'"
        :panel="visiblePanel"
        @toggle-device="toggleDevice"
        @device="togglePanel"
        @participant="showParticipant"
        @leave="leave"
        @collapse="notify('requestCollapse')"
        @expand="(active) => notify('requestExpand', active)"
        @close-panel="panel = null"
      >
        <div class="widget-call__panel-head">
          <strong>{{ panelTitle }}</strong>
          <IconButton label="Закрыть" :tooltip-target="shell ?? undefined" @click="panel = null">
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <section v-if="visiblePanel === 'camera'" aria-label="Настройки камеры" class="widget-call__settings">
          <label
            >Камера<NativeSelect
              v-model="devices.cameraId"
              class="widget-call__select"
              size="sm"
              :options="devices.cameraOptions"
              @value-change="run(() => switchCamera(devices.cameraId))"
          /></label>
        </section>
        <section v-else-if="visiblePanel === 'input'" aria-label="Настройки микрофона" class="widget-call__settings">
          <label
            >Микрофон<NativeSelect
              v-model="devices.microphoneId"
              class="widget-call__select"
              size="sm"
              :options="devices.microphoneOptions"
              @value-change="run(switchMicrophone)"
          /></label>
          <label
            >Шумоподавление<NativeSelect
              v-model="devices.noiseMode"
              class="widget-call__select"
              size="sm"
              :options="noiseOptions"
              @value-change="run(switchNoiseMode)"
          /></label>
        </section>
        <section v-else-if="visiblePanel === 'output'" aria-label="Настройки динамика" class="widget-call__settings">
          <label>
            Вывод звука
            <NativeSelect
              v-model="devices.outputDeviceId"
              class="widget-call__select"
              size="sm"
              :options="devices.outputOptions"
              @value-change="run(switchOutputDevice)"
            />
          </label>
        </section>
        <section
          v-else-if="visiblePanel === 'participant' && selectedParticipant"
          class="widget-call__settings"
          aria-label="Громкость участника"
        >
          <div class="widget-call__volume-head">
            <span>Громкость</span>
            <output aria-hidden="true">{{ Math.round(participantVolume * 100) }}%</output>
          </div>
          <Slider
            :model-value="participantVolume"
            :min="0"
            :max="1"
            :step="0.05"
            aria-label="Громкость"
            :aria-value-text="Math.round(participantVolume * 100) + '%'"
            @value-change="updateVolume"
          />
          <Button size="sm" @click="updateVolume(participantVolume === 0 ? 1 : 0)">
            {{ participantVolume === 0 ? 'Включить локально' : 'Отключить локально' }}
          </Button>
        </section>
      </WidgetCallLayout>
    </div>
    <footer class="widget-shell__credit">
      Powered by <a :href="WIDGET_SERVICE_URL" target="_blank" rel="noopener noreferrer">VoiceRoom</a>
    </footer>
  </main>
</template>
