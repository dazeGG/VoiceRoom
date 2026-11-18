<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, computed, watch } from 'vue';
import { X } from '@lucide/vue';
import { WIDGET_SERVICE_URL, parseWidgetMessage, type WidgetBootstrap } from '@voice-room/shared/contracts/widget';
import { createWidgetRuntime } from './runtime';
import WidgetCallLayout from './WidgetCallLayout.vue';
import WidgetJoinControls from './WidgetJoinControls.vue';
const props = defineProps<{ bootstrap: WidgetBootstrap }>();
const mediaMount = ref<HTMLElement | null>(null);
const runtime = shallowRef<ReturnType<typeof createWidgetRuntime> | null>(null);
const code = ref('');
const cameraDevice = ref('');
const expandable = ref(false);
const expanded = ref(false);
const cameraAllowed = computed(() => props.bootstrap.config.camera !== false);
type Device = 'input' | 'output' | 'camera';
const panel = ref<Device | 'participant' | null>(null);
const panelLabels = {
  input: 'Настройки микрофона',
  output: 'Настройки динамика',
  camera: 'Настройки камеры'
};
const participantId = ref('');
const participants = computed(() => {
  const call = runtime.value;
  if (!call?.state.joined) return [];
  const self = call.state.peers.find((peer) => peer.id === call.peerId);
  return [
    {
      id: call.peerId,
      name: call.state.name || 'Вы',
      self: true,
      muted: call.state.muted || self?.serverMuted === true,
      speaking: call.speaking(call.peerId),
      video: call.video(call.peerId)
    },
    ...call.state.peers
      .filter((peer) => peer.id !== call.peerId)
      .map((peer) => ({
        id: peer.id,
        name: peer.name || 'Гость',
        muted: peer.muted === true || peer.serverMuted,
        speaking: call.speaking(peer.id),
        video: call.video(peer.id)
      }))
  ];
});
const selectedParticipant = computed(() => participants.value.find(({ id }) => id === participantId.value));
const visiblePanel = computed(() => (panel.value === 'participant' && !selectedParticipant.value ? null : panel.value));
const panelTitle = computed(() => {
  const current = visiblePanel.value;
  if (current === 'participant') return selectedParticipant.value?.name;
  return current ? panelLabels[current] : '';
});
watch(
  () => runtime.value?.state.joined,
  (joined) => {
    if (!joined) panel.value = null;
  }
);
const style = computed(() => ({
  '--vr-bg': props.bootstrap.config.background,
  '--vr-text': props.bootstrap.config.text,
  '--vr-accent': props.bootstrap.config.accent,
  '--widget-radius': `${props.bootstrap.config.radius}px`,
  borderRadius: `${props.bootstrap.config.radius}px`
}));
const notify = (type: 'callState' | 'requestCollapse' | 'requestExpand', active?: boolean) =>
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
onMounted(() => {
  window.addEventListener('message', receiveExpansion);
  if (mediaMount.value)
    runtime.value = createWidgetRuntime(mediaMount.value, (active) => notify('callState', active), cameraAllowed.value);
});
onBeforeUnmount(() => {
  window.removeEventListener('message', receiveExpansion);
  runtime.value?.leave();
});
async function run(action: () => Promise<unknown> | undefined) {
  try {
    await action();
  } catch (error) {
    runtime.value?.report(error);
  }
}
function volume(peer: string, event: Event) {
  if (event.target instanceof HTMLInputElement) runtime.value?.volume(peer, Number(event.target.value));
}
function togglePanel(next: Device) {
  panel.value = panel.value === next ? null : next;
  if (panel.value) void run(() => runtime.value?.devices());
}
function toggleDevice(device: Device) {
  const call = runtime.value;
  if (!call) return;
  if (device === 'input') call.mute();
  else if (device === 'output') void run(() => call.toggleOutput());
  else void run(() => call.camera(!call.state.camera, cameraDevice.value));
}
function showParticipant(id: string) {
  panel.value = panel.value === 'participant' && participantId.value === id ? null : 'participant';
  participantId.value = id;
}
</script>
<template>
  <main class="widget-shell" :class="{ 'widget-shell--call': runtime?.state.joined }" :style="style">
    <header v-if="bootstrap.config.mode === 'floating' && !runtime?.state.joined" class="widget-shell__header">
      <button type="button" @click="notify('requestCollapse')">Свернуть</button>
    </header>
    <div v-if="runtime" class="widget-shell__body">
      <p v-if="!runtime.state.joined" role="status" class="widget-shell__status">{{ runtime.state.status }}</p>
      <p v-if="runtime.state.error" role="alert">{{ runtime.state.error }}</p>
      <WidgetJoinControls
        v-if="!runtime.state.joined"
        v-model:name="runtime.state.name"
        v-model:code="code"
        :title="bootstrap.config.title"
        @create="run(() => runtime?.create())"
        @join="run(() => runtime?.join(code))"
      />
      <WidgetCallLayout
        v-else
        :members="participants"
        :room-code="runtime.state.roomId"
        :status="runtime.state.status"
        :quality="runtime.connectionQuality()"
        :muted="runtime.state.muted"
        :output-muted="runtime.state.outputMuted || runtime.outputBlocked()"
        :camera="runtime.state.camera"
        :camera-allowed="cameraAllowed"
        :expandable="expandable"
        :expanded="expanded"
        :floating="bootstrap.config.mode === 'floating'"
        :panel="visiblePanel"
        @toggle-device="toggleDevice"
        @device="togglePanel"
        @participant="showParticipant"
        @leave="runtime.leave()"
        @collapse="notify('requestCollapse')"
        @expand="(active) => notify('requestExpand', active)"
        @close-panel="panel = null"
      >
        <div class="widget-call__panel-head">
          <strong>{{ panelTitle }}</strong>
          <button type="button" aria-label="Закрыть" title="Закрыть" @click="panel = null">
            <X :size="16" aria-hidden="true" />
          </button>
        </div>
        <section v-if="visiblePanel === 'camera'" aria-label="Настройки камеры" class="widget-call__settings">
          <label
            >Камера<select
              v-model="cameraDevice"
              @change="runtime.state.camera && run(() => runtime?.camera(true, cameraDevice))"
            >
              <option value="">По умолчанию</option>
              <option
                v-for="device in runtime.state.devices.filter((d) => d.kind === 'videoinput')"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || 'Камера' }}
              </option>
            </select></label
          >
        </section>
        <section v-else-if="visiblePanel === 'input'" aria-label="Настройки микрофона" class="widget-call__settings">
          <label
            >Микрофон<select v-model="runtime.state.input" @change="run(() => runtime?.capture())">
              <option value="">По умолчанию</option>
              <option
                v-for="device in runtime.state.devices.filter((d) => d.kind === 'audioinput')"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || 'Микрофон' }}
              </option>
            </select></label
          >
          <label
            >Шумоподавление<select v-model="runtime.state.noise" @change="run(() => runtime?.capture())">
              <option value="rnnoise">RNNoise</option>
              <option value="browser">Браузерное</option>
              <option value="off">Выключено</option>
            </select></label
          >
        </section>
        <section v-else-if="visiblePanel === 'output'" aria-label="Настройки динамика" class="widget-call__settings">
          <label>
            Вывод звука
            <select
              v-model="runtime.state.output"
              @change="run(() => runtime?.media.outputDevice(runtime.state.output))"
            >
              <option value="">По умолчанию</option>
              <option
                v-for="device in runtime.state.devices.filter((d) => d.kind === 'audiooutput')"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || 'Динамики' }}
              </option>
            </select>
          </label>
        </section>
        <section
          v-else-if="visiblePanel === 'participant' && selectedParticipant"
          class="widget-call__settings"
          aria-label="Громкость участника"
        >
          <label
            >Громкость<input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="runtime.state.localVolumes[selectedParticipant.id] ?? 1"
              @input="volume(selectedParticipant.id, $event)"
          /></label>
          <button
            type="button"
            @click="
              runtime.volume(selectedParticipant.id, runtime.state.localVolumes[selectedParticipant.id] === 0 ? 1 : 0)
            "
          >
            {{ runtime.state.localVolumes[selectedParticipant.id] === 0 ? 'Включить локально' : 'Отключить локально' }}
          </button>
        </section>
      </WidgetCallLayout>
    </div>
    <div ref="mediaMount" class="widget-media" />
    <footer class="widget-shell__credit">
      Powered by <a :href="WIDGET_SERVICE_URL" target="_blank" rel="noopener noreferrer">VoiceRoom</a>
    </footer>
  </main>
</template>
