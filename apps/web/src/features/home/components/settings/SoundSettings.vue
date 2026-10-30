<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  GATE_ON_DEFAULT_DB,
  playDirectMessageCue,
  playFriendAcceptedCue,
  playMicCue,
  playPeerCue,
  playRoomChatMessageCue,
  playStreamCue,
  setMicrophoneMode,
  setMicrophoneVolume,
  setOutputDevice,
  syncAudioBusSettings,
  type MicrophoneMode
} from '@/features/room/client';
import { SegmentControl, Select, Slider, type SegmentOption } from '@/shared/ui';
import {
  enumerateMicrophones,
  enumerateSpeakers,
  gateMeterPosition,
  gateValueLabel,
  isGateDisabled,
  NOISE_OPTIONS,
  persistGateThreshold,
  persistMasterVolume,
  persistMicrophone,
  persistNoiseMode,
  persistNotificationVolume,
  persistSpeaker,
  readSoundSettings,
  startMicMeter,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  type DeviceOption,
  type MicMeter
} from '../../model/sound-settings';
import { readRoomSwitchConfirmEnabled, writeRoomSwitchConfirmEnabled } from '../../model/room-switch-confirmation';
import type { ToastOptions } from '../../model/toasts.store';
import HotkeyRow from './HotkeyRow.vue';

defineProps<{ desktopApp: boolean }>();

const emit = defineEmits<{ toast: [message: string, options?: ToastOptions] }>();

const PREVIEW_CUE_GAP_MS = 620;

const saved = readSoundSettings();
const savedGateOn = !isGateDisabled(saved.gateThresholdDb);

const microphones = ref<DeviceOption[]>([]);
const speakers = ref<DeviceOption[]>([]);
const micId = ref(saved.microphoneDeviceId);
const speakerId = ref(saved.outputDeviceId);
const noiseMode = ref(saved.noiseMode);
const gateOn = ref(savedGateOn);
const gateDb = ref(savedGateOn ? saved.gateThresholdDb : GATE_ON_DEFAULT_DB);
const micLevelDb = ref(GATE_THRESHOLD_MIN_DB);
const micVolume = ref(saved.microphoneVolume);
const microphoneMode = ref<MicrophoneMode>(saved.microphoneMode);
const masterVolume = ref(saved.masterVolume);
const notificationVolume = ref(saved.notificationVolume);
const confirmRoomSwitch = ref(readRoomSwitchConfirmEnabled());
const previewingSoundSet = ref(false);
let confirmedSpeakerId = saved.outputDeviceId;
let speakerChangeGeneration = 0;
let activeMicMeter: MicMeter | null = null;
let latestMicVolume = saved.microphoneVolume;
let soundPreviewTimers: number[] = [];

const gateOpen = computed(() => !gateOn.value || micLevelDb.value >= gateDb.value);
// Only surface the live level while the gate is on — off means "don't capture
// or show the mic level" (the meter watcher below stops capturing too).
const levelScale = computed(() => (gateOn.value ? gateMeterPosition(micLevelDb.value).toFixed(3) : '0'));
const gateLabel = computed(() => (gateOn.value ? gateValueLabel(gateDb.value) : 'Выкл'));
const microphoneOptions = computed(() => [
  { value: '', label: 'Системный' },
  ...microphones.value.map((mic) => ({ value: mic.deviceId, label: mic.label }))
]);
const speakerOptions = computed(() => [
  { value: '', label: 'Системный' },
  ...speakers.value.map((speaker) => ({ value: speaker.deviceId, label: speaker.label }))
]);
const MICROPHONE_MODE_OPTIONS: SegmentOption<MicrophoneMode>[] = [
  { value: 'open', label: 'Открытый микрофон' },
  { value: 'push-to-talk', label: 'Push-to-talk' }
];
const NOISE_ORDER = ['off', 'browser', 'rnnoise'];
const noiseOptions = [...NOISE_OPTIONS]
  .sort((a, b) => NOISE_ORDER.indexOf(a.value) - NOISE_ORDER.indexOf(b.value))
  .map((option) => ({ value: option.value, label: option.label }));

onMounted(() => {
  void enumerateMicrophones().then((list) => (microphones.value = list));
  void enumerateSpeakers().then((list) => (speakers.value = list));
});

// Live mic meter while the gate is on, so the mic is captured solely to show
// the level for tuning the threshold. It is released the moment the gate goes
// off or the tab closes.
watch(
  [gateOn, micId],
  ([on, id], _before, onCleanup) => {
    if (!on) return;
    latestMicVolume = micVolume.value;
    let active = true;
    let meter: MicMeter | null = null;

    void startMicMeter(id, latestMicVolume, (db) => {
      if (active) micLevelDb.value = db;
    }).then((started) => {
      if (!active) {
        started?.stop();
        return;
      }
      meter = started;
      activeMicMeter = started;
      if (started) {
        started.setVolume(latestMicVolume);
        // Permission granted: device labels are now readable, so refresh the lists.
        void enumerateMicrophones().then((list) => {
          if (active) microphones.value = list;
        });
        void enumerateSpeakers().then((list) => {
          if (active) speakers.value = list;
        });
      }
    });

    onCleanup(() => {
      active = false;
      if (activeMicMeter === meter) activeMicMeter = null;
      meter?.stop();
      micLevelDb.value = GATE_THRESHOLD_MIN_DB;
    });
  },
  { immediate: true }
);

function stopSoundPreview(): void {
  for (const timer of soundPreviewTimers) window.clearTimeout(timer);
  soundPreviewTimers = [];
  previewingSoundSet.value = false;
}

onBeforeUnmount(stopSoundPreview);

function onMicChange(value: string): void {
  micId.value = value;
  persistMicrophone(micId.value);
}

async function onSpeakerChange(value: string): Promise<void> {
  const generation = ++speakerChangeGeneration;
  speakerId.value = value;
  persistSpeaker(speakerId.value);
  const synced = await setOutputDevice(speakerId.value);
  if (generation !== speakerChangeGeneration) return;
  if (synced) {
    confirmedSpeakerId = speakerId.value;
    return;
  }

  speakerId.value = confirmedSpeakerId;
  persistSpeaker(confirmedSpeakerId);
  await setOutputDevice(confirmedSpeakerId);
  emit('toast', 'Не удалось переключить динамик');
}

function onNoiseChange(value: string): void {
  noiseMode.value = persistNoiseMode(value);
}

function persistGate(): void {
  persistGateThreshold(gateOn.value ? gateDb.value : GATE_THRESHOLD_MIN_DB);
}

function toggleGate(): void {
  gateOn.value = !gateOn.value;
  persistGate();
}

function onGateChange(value: number): void {
  gateDb.value = Math.round(value);
  if (gateOn.value) persistGate();
}

function onNotificationVolumeChange(value: number): void {
  notificationVolume.value = persistNotificationVolume(value);
  syncAudioBusSettings();
}

function onMasterVolumeChange(value: number): void {
  masterVolume.value = persistMasterVolume(value);
  syncAudioBusSettings();
}

function onMicrophoneVolumeChange(value: number): void {
  micVolume.value = setMicrophoneVolume(value);
  latestMicVolume = micVolume.value;
  activeMicMeter?.setVolume(latestMicVolume);
}

function changeMicrophoneMode(mode: MicrophoneMode): void {
  microphoneMode.value = setMicrophoneMode(mode);
}

function onPushToTalkOff(): void {
  microphoneMode.value = 'open';
  emit('toast', 'Push-to-talk выключен: клавиша не назначена');
}

function toggleRoomSwitchConfirm(): void {
  confirmRoomSwitch.value = !confirmRoomSwitch.value;
  writeRoomSwitchConfirmEnabled(confirmRoomSwitch.value);
}

function previewNotificationSound(): void {
  if (previewingSoundSet.value) return;
  stopSoundPreview();
  previewingSoundSet.value = true;
  const cues = [
    () => playPeerCue('join'),
    () => playMicCue(true),
    () => playStreamCue('start'),
    () => playRoomChatMessageCue(),
    () => playDirectMessageCue(),
    () => playFriendAcceptedCue()
  ];
  cues.forEach((play, index) => {
    soundPreviewTimers.push(window.setTimeout(play, index * PREVIEW_CUE_GAP_MS));
  });
  soundPreviewTimers.push(window.setTimeout(stopSoundPreview, cues.length * PREVIEW_CUE_GAP_MS));
}
</script>

<template>
  <div class="settings__sound">
    <div class="settings__sound-devices">
      <section class="settings__sound-device" aria-labelledby="microphoneSettingsTitle">
        <div>
          <span id="microphoneSettingsTitle" class="settings__field-label">Микрофон</span>
          <Select
            v-model="micId"
            :options="microphoneOptions"
            label="Микрофон"
            variant="field"
            @value-change="onMicChange"
          />
        </div>
        <div>
          <div class="settings__sound-head">
            <span class="settings__field-label">Громкость микрофона</span>
            <output class="settings__sound-value">{{ Math.round(micVolume) }}%</output>
          </div>
          <Slider
            v-model="micVolume"
            :min="0"
            :max="200"
            :default-value="100"
            :step="1"
            aria-label="Громкость микрофона"
            :aria-value-text="`${Math.round(micVolume)}%`"
            @value-change="onMicrophoneVolumeChange"
          />
          <div class="settings__gate-hint">Усиление после шумодава и гейта. Выше 100% работает лимитер.</div>
        </div>

        <div class="settings__sound-device-section">
          <span class="settings__field-label">Шумоподавление</span>
          <SegmentControl
            class="settings__segment"
            :options="noiseOptions"
            :value="noiseMode"
            v-bind="{ ariaLabel: 'Шумоподавление' }"
            @change="onNoiseChange"
          />
        </div>

        <div class="settings__sound-device-section">
          <div class="settings__gate-head">
            <span class="settings__field-label">Гейт</span>
            <button
              class="settings__switch"
              type="button"
              role="switch"
              :aria-checked="gateOn"
              aria-label="Шумовой гейт"
              @click="toggleGate"
            >
              <span class="settings__switch-knob" aria-hidden="true"></span>
            </button>
          </div>

          <div class="settings__gate-body" :class="{ 'settings__gate-body--disabled': !gateOn }">
            <div class="settings__gate">
              <Slider
                v-model="gateDb"
                :min="GATE_THRESHOLD_MIN_DB"
                :max="GATE_THRESHOLD_MAX_DB"
                :step="1"
                :default-value="GATE_ON_DEFAULT_DB"
                :disabled="!gateOn"
                :show-fill="false"
                aria-label="Порог гейта в децибелах"
                :aria-value-text="gateLabel"
                @value-change="onGateChange"
              >
                <template #background>
                  <span
                    class="settings__gate-fill"
                    :class="{ 'settings__gate-fill--closed': !gateOpen }"
                    :style="{ transform: `scaleX(${levelScale})` }"
                  ></span>
                </template>
              </Slider>
              <span class="settings__gate-value">{{ gateLabel }}</span>
            </div>
            <div class="settings__gate-hint">
              Микрофон открывается, только когда звук громче порога — отсекает фоновый шум и дыхание.
            </div>
          </div>
        </div>
      </section>

      <section class="settings__sound-device" aria-labelledby="speakerSettingsTitle">
        <div>
          <span id="speakerSettingsTitle" class="settings__field-label">Динамик</span>
          <Select
            v-model="speakerId"
            :options="speakerOptions"
            label="Динамик"
            variant="field"
            @value-change="onSpeakerChange"
          />
        </div>
        <div>
          <div class="settings__sound-head">
            <span class="settings__field-label">Общая громкость</span>
            <output class="settings__sound-value">{{ Math.round(masterVolume) }}%</output>
          </div>
          <Slider
            v-model="masterVolume"
            :min="0"
            :max="200"
            :default-value="100"
            :step="1"
            aria-label="Общая громкость"
            :aria-value-text="`${Math.round(masterVolume)}%`"
            @value-change="onMasterVolumeChange"
          />
          <div class="settings__gate-hint">Голоса, стримы и интерфейс. Выше 100% работает лимитер.</div>
        </div>

        <div class="settings__sound-device-section">
          <div class="settings__sound-head">
            <span class="settings__field-label">Звуки интерфейса</span>
            <output class="settings__sound-value">{{ Math.round(notificationVolume) }}%</output>
          </div>
          <Slider
            v-model="notificationVolume"
            :min="0"
            :max="200"
            :default-value="100"
            :step="1"
            aria-label="Звуки интерфейса"
            :aria-value-text="`${Math.round(notificationVolume)}%`"
            @value-change="onNotificationVolumeChange"
          />
          <div class="settings__sound-actions">
            <button
              class="settings__sound-preview"
              type="button"
              :disabled="previewingSoundSet"
              @click="previewNotificationSound"
            >
              {{ previewingSoundSet ? 'Проверяем…' : 'Проверить набор' }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div>
      <div class="settings__gate-head">
        <span class="settings__field-label">Спрашивать перед переходом в другую комнату</span>
        <button
          class="settings__switch"
          type="button"
          role="switch"
          :aria-checked="confirmRoomSwitch"
          aria-label="Спрашивать перед переходом в другую комнату"
          @click="toggleRoomSwitchConfirm"
        >
          <span class="settings__switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings__gate-hint">Когда вы уже в голосе, VoiceRoom уточнит, прежде чем переключить звонок.</div>
    </div>

    <div v-if="desktopApp" class="settings__hotkeys">
      <div>
        <span class="settings__section-title">Режим микрофона</span>
        <SegmentControl
          class="settings__segment"
          :options="MICROPHONE_MODE_OPTIONS"
          :value="microphoneMode"
          v-bind="{ ariaLabel: 'Режим микрофона' }"
          @change="changeMicrophoneMode"
        />
        <div class="settings__gate-hint">В Push-to-talk микрофон открыт, пока вы удерживаете назначенную клавишу.</div>
      </div>

      <HotkeyRow
        action="push-to-talk"
        label="Push-to-talk"
        description="Удерживайте, чтобы открыть микрофон"
        v-bind="{ ariaLabel: 'Клавиша Push-to-talk' }"
        :disabled="microphoneMode !== 'push-to-talk'"
        @push-to-talk-off="onPushToTalkOff"
      />
    </div>
  </div>
</template>
