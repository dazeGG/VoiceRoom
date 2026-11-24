<script setup lang="ts">
import EmojiText from '@/shared/chat/EmojiText.vue';
import { t } from '@/shared/i18n';
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import {
  GATE_ON_DEFAULT_DB,
  playDirectMessageCue,
  playFriendAcceptedCue,
  playMicCue,
  playPeerCue,
  playRoomChatMessageCue,
  playStreamCue,
  restoreOutputDevice,
  setMicrophoneMode,
  setMicrophoneVolume,
  setOutputDevice,
  syncAudioBusSettings,
  syncNativeVoiceReceive,
  type MicrophoneMode
} from '@voiceroom/call/engine';
import { withSavedDeviceMissing } from '@/shared/audio/device-list';
import {
  SegmentControl,
  Slider,
  Switch,
  type SegmentOption,
  SettingRow,
  SettingsGroup,
  Select,
  Button
} from '@voiceroom/ui-kit/components';
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
import { readDesktopNativeVoicePreference, writeDesktopNativeVoicePreference } from '@/platform/desktop-native-voice';
import type { ToastOptions } from '../../model/toasts.store';
import HotkeyRow from './HotkeyRow.vue';

const props = defineProps<{ desktopApp: boolean; nativeVoiceDefaultEnabled?: boolean | undefined }>();

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
const nativeVoicePreference = ref(readDesktopNativeVoicePreference());
const nativeVoiceDescriptionId = useId();
const nativeVoiceEnabled = computed(
  () =>
    nativeVoicePreference.value === 'on' ||
    (nativeVoicePreference.value === 'default' && props.nativeVoiceDefaultEnabled === true)
);

function toggleNativeVoice(enabled: boolean): void {
  const preference = enabled ? 'on' : 'off';
  nativeVoicePreference.value = preference;
  writeDesktopNativeVoicePreference(preference);
  if (!enabled) syncNativeVoiceReceive();
}
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
const gateLabel = computed(() => (gateOn.value ? gateValueLabel(gateDb.value) : t('Выкл')));
const microphoneOptions = computed(() => [
  { value: '', label: t('Системный') },
  ...microphones.value.map((mic) => ({ value: mic.deviceId, label: mic.label }))
]);
const speakerOptions = computed(() =>
  withSavedDeviceMissing(
    [
      { value: '', label: t('Системный') },
      ...speakers.value.map((speaker) => ({ value: speaker.deviceId, label: speaker.label }))
    ],
    speakerId.value
  )
);
const MICROPHONE_MODE_OPTIONS: SegmentOption<MicrophoneMode>[] = [
  {
    value: 'open',
    get label() {
      return t('Открытый микрофон');
    }
  },
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
  await restoreOutputDevice(confirmedSpeakerId);
  emit('toast', t('Не удалось переключить динамик'));
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
  emit('toast', t('Push-to-talk выключен: клавиша не назначена'));
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
      <SettingsGroup role="region" :aria-label="t('Микрофон')">
        <SettingRow :label="t('Микрофон')" stacked>
          <template #control>
            <Select
              v-model="micId"
              :options="microphoneOptions"
              :label="t('Микрофон')"
              size="md"
              @value-change="onMicChange"
              ><template #option-label="{ text }"><EmojiText :text="text" /></template
            ></Select>
          </template>
        </SettingRow>
        <SettingRow
          :label="t('Громкость микрофона')"
          :description="t('Усиление после шумодава и гейта. Выше 100% работает лимитер.')"
          stacked
        >
          <template #control>
            <div class="settings__sound-control">
              <Slider
                v-model="micVolume"
                :min="0"
                :max="200"
                :default-value="100"
                :step="1"
                :aria-label="t('Громкость микрофона')"
                :aria-value-text="`${Math.round(micVolume)}%`"
                @value-change="onMicrophoneVolumeChange"
              />
              <output class="settings__sound-value">{{ Math.round(micVolume) }}%</output>
            </div>
          </template>
        </SettingRow>

        <SettingRow :label="t('Шумоподавление')" stacked>
          <template #control>
            <SegmentControl
              layout="equal"
              class="settings__segment"
              :options="noiseOptions"
              :value="noiseMode"
              v-bind="{ ariaLabel: t('Шумоподавление') }"
              @change="onNoiseChange"
            />
          </template>
        </SettingRow>

        <SettingRow :label="t('Гейт')">
          <template #control>
            <Switch :model-value="gateOn" v-bind="{ ariaLabel: t('Шумовой гейт') }" @update:model-value="toggleGate" />
          </template>
        </SettingRow>

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
              :aria-label="t('Порог гейта в децибелах')"
              :aria-value-text="gateLabel"
              @value-change="onGateChange"
            >
              <template #background>
                <span
                  class="settings__gate-fill"
                  :class="{ 'settings__gate-fill--closed': !gateOpen }"
                  :style="{ transform: `scaleX(${levelScale})` }"
                >
                </span>
              </template>
            </Slider>
            <span class="settings__gate-value">{{ gateLabel }}</span>
          </div>
          <div class="settings__gate-hint">
            {{ t('Микрофон открывается, только когда звук громче порога — отсекает фоновый шум и дыхание.') }}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup role="region" :aria-label="t('Динамик')">
        <SettingRow :label="t('Динамик')" stacked>
          <template #control>
            <Select
              v-model="speakerId"
              :options="speakerOptions"
              :label="t('Динамик')"
              size="md"
              @value-change="onSpeakerChange"
              ><template #option-label="{ text }"><EmojiText :text="text" /></template
            ></Select>
          </template>
        </SettingRow>
        <SettingRow
          :label="t('Общая громкость')"
          :description="t('Голоса, стримы и интерфейс. Выше 100% работает лимитер.')"
          stacked
        >
          <template #control>
            <div class="settings__sound-control">
              <Slider
                v-model="masterVolume"
                :min="0"
                :max="200"
                :default-value="100"
                :step="1"
                :aria-label="t('Общая громкость')"
                :aria-value-text="`${Math.round(masterVolume)}%`"
                @value-change="onMasterVolumeChange"
              />
              <output class="settings__sound-value">{{ Math.round(masterVolume) }}%</output>
            </div>
          </template>
        </SettingRow>

        <SettingRow :label="t('Звуки интерфейса')" stacked>
          <template #control>
            <div class="settings__sound-control">
              <Slider
                v-model="notificationVolume"
                :min="0"
                :max="200"
                :default-value="100"
                :step="1"
                :aria-label="t('Звуки интерфейса')"
                :aria-value-text="`${Math.round(notificationVolume)}%`"
                @value-change="onNotificationVolumeChange"
              />
              <output class="settings__sound-value">{{ Math.round(notificationVolume) }}%</output>
            </div>
            <div class="settings__sound-actions">
              <Button
                variant="ghost"
                size="sm"
                class="settings__sound-preview"
                :disabled="previewingSoundSet"
                @click="previewNotificationSound"
              >
                {{ previewingSoundSet ? t('Проверяем…') : t('Проверить набор') }}
              </Button>
            </div>
          </template>
        </SettingRow>
      </SettingsGroup>
    </div>

    <SettingsGroup>
      <SettingRow
        :label="t('Спрашивать перед переходом в другую комнату')"
        :description="t('Когда вы уже в голосе, VoiceRoom уточнит, прежде чем переключить звонок.')"
      >
        <template #control>
          <Switch
            :model-value="confirmRoomSwitch"
            v-bind="{ ariaLabel: t('Спрашивать перед переходом в другую комнату') }"
            @update:model-value="toggleRoomSwitchConfirm"
          />
        </template>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup v-if="desktopApp">
      <SettingRow v-if="nativeVoicePreference" :label="t('Нативный звук (beta)')">
        <template #description>
          <span :id="nativeVoiceDescriptionId">{{
            t(
              'Воспроизводит голоса собеседников через системный звуковой движок. Если звук работает неправильно, выключите этот режим. Включение применяется при следующем подключении.'
            )
          }}</span>
        </template>
        <template #control>
          <Switch
            :model-value="nativeVoiceEnabled"
            v-bind="{ ariaLabel: t('Нативный звук (beta)') }"
            :aria-describedby="nativeVoiceDescriptionId"
            @update:model-value="toggleNativeVoice"
          />
        </template>
      </SettingRow>

      <SettingRow
        :label="t('Режим микрофона')"
        :description="t('В Push-to-talk микрофон открыт, пока вы удерживаете назначенную клавишу.')"
        stacked
      >
        <template #control>
          <SegmentControl
            layout="equal"
            class="settings__segment"
            :options="MICROPHONE_MODE_OPTIONS"
            :value="microphoneMode"
            v-bind="{ ariaLabel: t('Режим микрофона') }"
            @change="changeMicrophoneMode"
          />
        </template>
      </SettingRow>

      <HotkeyRow
        action="push-to-talk"
        label="Push-to-talk"
        :description="t('Удерживайте, чтобы открыть микрофон')"
        v-bind="{ ariaLabel: t('Клавиша Push-to-talk') }"
        :disabled="microphoneMode !== 'push-to-talk'"
        @push-to-talk-off="onPushToTalkOff"
      />
    </SettingsGroup>
  </div>
</template>
