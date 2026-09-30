<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import {
    playPeerCue,
    playDirectMessageCue,
    playFriendAcceptedCue,
    playMicCue,
    playRoomChatMessageCue,
    playStreamCue
  } from '$lib/features/room/client/media/cues';
  import { state as roomClientState } from '$lib/features/room/client/core/state.svelte';
  import type { MicrophoneMode } from '$lib/features/room/client/core/config';
  import { syncAudioBusOutput, syncAudioBusSettings } from '$lib/features/room/client/services/audio-bus';
  import { setMicrophoneVolume } from '$lib/features/room/client/services/microphone-service';
  import { setMicrophoneMode } from '$lib/features/room/client/ui/controls';
  import { Select, Slider } from '$lib/shared/ui';
  import {
    enumerateMicrophones,
    enumerateSpeakers,
    gateMeterPosition,
    gateValueLabel,
    isGateDisabled,
    NOISE_OPTIONS,
    persistGateAuto,
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
  import type { ToastOptions } from '../../model/toasts.svelte';
  import HotkeyRow from './HotkeyRow.svelte';

  let {
    desktopApp,
    onToast
  }: {
    desktopApp: boolean;
    onToast: (message: string, options?: ToastOptions) => void;
  } = $props();

  // Default speaking-level threshold used when the gate is switched on from "off".
  const GATE_DEFAULT_DB = -40;
  const PREVIEW_CUE_GAP_MS = 620;

  const saved = readSoundSettings();
  const savedGateOn = !isGateDisabled(saved.gateThresholdDb);

  let microphones = $state<DeviceOption[]>([]);
  let speakers = $state<DeviceOption[]>([]);
  let micId = $state(saved.microphoneDeviceId);
  let speakerId = $state(saved.outputDeviceId);
  let noiseMode = $state(saved.noiseMode);
  let gateOn = $state(savedGateOn);
  let gateAuto = $state(saved.gateAuto);
  let gateDb = $state(savedGateOn ? saved.gateThresholdDb : GATE_DEFAULT_DB);
  let micLevelDb = $state(GATE_THRESHOLD_MIN_DB);
  let micVolume = $state(saved.microphoneVolume);
  let microphoneMode = $state<MicrophoneMode>(saved.microphoneMode);
  let masterVolume = $state(saved.masterVolume);
  let notificationVolume = $state(saved.notificationVolume);
  let confirmRoomSwitch = $state(readRoomSwitchConfirmEnabled());
  let previewingSoundSet = $state(false);
  let confirmedSpeakerId = saved.outputDeviceId;
  let speakerChangeGeneration = 0;
  let activeMicMeter: MicMeter | null = null;
  let latestMicVolume = saved.microphoneVolume;
  let soundPreviewTimers: number[] = [];

  const gateOpen = $derived(!gateOn || micLevelDb >= gateDb);
  // Only surface the live level while the gate is on — off means "don't capture
  // or show the mic level" (the meter effect below stops capturing too).
  const levelScale = $derived(gateOn ? gateMeterPosition(micLevelDb).toFixed(3) : '0');
  const gateLabel = $derived(gateOn ? (gateAuto ? 'Авто' : gateValueLabel(gateDb)) : 'Выкл');
  const microphoneOptions = $derived([
    { value: '', label: 'Системный' },
    ...microphones.map((mic) => ({ value: mic.deviceId, label: mic.label }))
  ]);
  const speakerOptions = $derived([
    { value: '', label: 'Системный' },
    ...speakers.map((speaker) => ({ value: speaker.deviceId, label: speaker.label }))
  ]);
  const noiseOptions = NOISE_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

  onMount(() => {
    void enumerateMicrophones().then((list) => (microphones = list));
    void enumerateSpeakers().then((list) => (speakers = list));
  });

  // Live mic meter while the gate is on, so the mic is captured solely to show
  // the level for tuning the threshold. It is released the moment the gate goes
  // off or the tab closes.
  $effect(() => {
    if (!gateOn) return;
    const id = micId;
    const inputVolume = untrack(() => micVolume);
    latestMicVolume = inputVolume;
    let active = true;
    let meter: MicMeter | null = null;

    void startMicMeter(id, inputVolume, (db) => {
      if (active) micLevelDb = db;
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
          if (active) microphones = list;
        });
        void enumerateSpeakers().then((list) => {
          if (active) speakers = list;
        });
      }
    });

    return () => {
      active = false;
      if (activeMicMeter === meter) activeMicMeter = null;
      meter?.stop();
      micLevelDb = GATE_THRESHOLD_MIN_DB;
    };
  });

  function stopSoundPreview(): void {
    for (const timer of soundPreviewTimers) window.clearTimeout(timer);
    soundPreviewTimers = [];
    previewingSoundSet = false;
  }

  onDestroy(stopSoundPreview);

  function onMicChange(value: string): void {
    micId = value;
    persistMicrophone(micId);
  }

  async function onSpeakerChange(value: string): Promise<void> {
    const generation = ++speakerChangeGeneration;
    speakerId = value;
    persistSpeaker(speakerId);
    roomClientState.outputDeviceId = speakerId;
    const synced = await syncAudioBusOutput(speakerId);
    if (generation !== speakerChangeGeneration) return;
    if (synced) {
      confirmedSpeakerId = speakerId;
      return;
    }

    speakerId = confirmedSpeakerId;
    persistSpeaker(confirmedSpeakerId);
    roomClientState.outputDeviceId = confirmedSpeakerId;
    await syncAudioBusOutput(confirmedSpeakerId);
    onToast('Не удалось переключить динамик');
  }

  function onNoiseChange(value: string): void {
    noiseMode = persistNoiseMode(value);
  }

  function persistGate(): void {
    persistGateThreshold(gateOn ? gateDb : GATE_THRESHOLD_MIN_DB);
  }

  function toggleGate(): void {
    gateOn = !gateOn;
    persistGate();
  }

  function toggleGateAuto(): void {
    gateAuto = persistGateAuto(!gateAuto);
  }

  function onGateChange(value: number): void {
    gateDb = Math.round(value);
    if (gateOn) persistGate();
  }

  function onNotificationVolumeChange(value: number): void {
    notificationVolume = persistNotificationVolume(value);
    syncAudioBusSettings();
  }

  function onMasterVolumeChange(value: number): void {
    masterVolume = persistMasterVolume(value);
    syncAudioBusSettings();
  }

  function onMicrophoneVolumeChange(value: number): void {
    micVolume = setMicrophoneVolume(value);
    latestMicVolume = micVolume;
    activeMicMeter?.setVolume(latestMicVolume);
  }

  function changeMicrophoneMode(mode: MicrophoneMode): void {
    microphoneMode = setMicrophoneMode(mode);
  }

  function onPushToTalkOff(): void {
    microphoneMode = 'open';
    onToast('Push-to-talk выключен: клавиша не назначена');
  }

  function toggleRoomSwitchConfirm(): void {
    confirmRoomSwitch = !confirmRoomSwitch;
    writeRoomSwitchConfirmEnabled(confirmRoomSwitch);
  }

  function previewNotificationSound(): void {
    if (previewingSoundSet) return;
    stopSoundPreview();
    previewingSoundSet = true;
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

<div class="settings-sound">
  <div class="settings-sound-devices">
    <section class="settings-sound-device" aria-labelledby="microphoneSettingsTitle">
      <div>
        <span class="settings-field-label" id="microphoneSettingsTitle">Микрофон</span>
        <Select
          bind:value={micId}
          options={microphoneOptions}
          label="Микрофон"
          variant="field"
          onValueChange={onMicChange}
        />
      </div>
      <div>
        <div class="settings-sound-head">
          <span class="settings-field-label">Громкость микрофона</span>
          <output class="settings-sound-value">{Math.round(micVolume)}%</output>
        </div>
        <Slider
          bind:value={micVolume}
          min={0}
          max={200}
          defaultValue={100}
          step={1}
          ariaLabel="Громкость микрофона"
          ariaValueText={`${Math.round(micVolume)}%`}
          onValueChange={onMicrophoneVolumeChange}
        />
        <div class="settings-gate-hint">Усиление после шумодава и гейта. Выше 100% работает лимитер.</div>
      </div>

      <div class="settings-sound-device-section">
        <span class="settings-field-label">Шумоподавление</span>
        <Select
          bind:value={noiseMode}
          options={noiseOptions}
          label="Шумоподавление"
          variant="field"
          onValueChange={onNoiseChange}
        />
      </div>

      <div class="settings-sound-device-section">
        <div class="settings-gate-head">
          <span class="settings-field-label">Гейт</span>
          <button
            class="settings-switch"
            type="button"
            role="switch"
            aria-checked={gateOn}
            aria-label="Шумовой гейт"
            onclick={toggleGate}
          >
            <span class="settings-switch-knob" aria-hidden="true"></span>
          </button>
        </div>

        {#if gateOn}
          <div class="settings-gate-head">
            <span class="settings-gate-hint">Автоматическая чувствительность</span>
            <button
              class="settings-switch"
              type="button"
              role="switch"
              aria-checked={gateAuto}
              aria-label="Автоматическая чувствительность гейта"
              onclick={toggleGateAuto}
            >
              <span class="settings-switch-knob" aria-hidden="true"></span>
            </button>
          </div>
        {/if}

        <div class="settings-gate-body" data-disabled={!gateOn || gateAuto}>
          <div class="settings-gate">
            <Slider
              bind:value={gateDb}
              min={GATE_THRESHOLD_MIN_DB}
              max={GATE_THRESHOLD_MAX_DB}
              step={1}
              defaultValue={GATE_DEFAULT_DB}
              disabled={!gateOn || gateAuto}
              showFill={false}
              ariaLabel="Порог гейта в децибелах"
              ariaValueText={gateLabel}
              onValueChange={onGateChange}
            >
              {#snippet background()}
                <span
                  class="settings-gate-fill"
                  data-state={gateOpen ? 'open' : 'closed'}
                  style={`transform:scaleX(${levelScale})`}
                ></span>
              {/snippet}
            </Slider>
            <span class="settings-gate-value">{gateLabel}</span>
          </div>
          <div class="settings-gate-hint">
            Микрофон открывается, только когда звук громче порога — отсекает фоновый шум и дыхание. В автоматическом
            режиме порог сам подстраивается под шум в комнате.
          </div>
        </div>
      </div>
    </section>

    <section class="settings-sound-device" aria-labelledby="speakerSettingsTitle">
      <div>
        <span class="settings-field-label" id="speakerSettingsTitle">Динамик</span>
        <Select
          bind:value={speakerId}
          options={speakerOptions}
          label="Динамик"
          variant="field"
          onValueChange={onSpeakerChange}
        />
      </div>
      <div>
        <div class="settings-sound-head">
          <span class="settings-field-label">Общая громкость</span>
          <output class="settings-sound-value">{Math.round(masterVolume)}%</output>
        </div>
        <Slider
          bind:value={masterVolume}
          min={0}
          max={200}
          defaultValue={100}
          step={1}
          ariaLabel="Общая громкость"
          ariaValueText={`${Math.round(masterVolume)}%`}
          onValueChange={onMasterVolumeChange}
        />
        <div class="settings-gate-hint">Голоса, стримы и интерфейс. Выше 100% работает лимитер.</div>
      </div>

      <div class="settings-sound-device-section">
        <div class="settings-sound-head">
          <span class="settings-field-label">Звуки интерфейса</span>
          <output class="settings-sound-value">{Math.round(notificationVolume)}%</output>
        </div>
        <Slider
          bind:value={notificationVolume}
          min={0}
          max={200}
          defaultValue={100}
          step={1}
          ariaLabel="Звуки интерфейса"
          ariaValueText={`${Math.round(notificationVolume)}%`}
          onValueChange={onNotificationVolumeChange}
        />
        <div class="settings-sound-actions">
          <button
            class="settings-sound-preview"
            type="button"
            disabled={previewingSoundSet}
            onclick={previewNotificationSound}
          >
            {previewingSoundSet ? 'Проверяем…' : 'Проверить набор'}
          </button>
        </div>
      </div>
    </section>
  </div>

  <div>
    <div class="settings-gate-head">
      <span class="settings-field-label">Спрашивать перед переходом в другую комнату</span>
      <button
        class="settings-switch"
        type="button"
        role="switch"
        aria-checked={confirmRoomSwitch}
        aria-label="Спрашивать перед переходом в другую комнату"
        onclick={toggleRoomSwitchConfirm}
      >
        <span class="settings-switch-knob" aria-hidden="true"></span>
      </button>
    </div>
    <div class="settings-gate-hint">Когда вы уже в голосе, Voice Room уточнит, прежде чем переключить звонок.</div>
  </div>

  {#if desktopApp}
    <div class="settings-hotkeys">
      <div>
        <span class="settings-section-title">Режим микрофона</span>
        <div class="settings-mode-toggle" role="radiogroup" aria-label="Режим микрофона">
          <button
            type="button"
            role="radio"
            aria-checked={microphoneMode === 'open'}
            onclick={() => changeMicrophoneMode('open')}>Открытый микрофон</button
          >
          <button
            type="button"
            role="radio"
            aria-checked={microphoneMode === 'push-to-talk'}
            onclick={() => changeMicrophoneMode('push-to-talk')}>Push-to-talk</button
          >
        </div>
        <div class="settings-gate-hint">В Push-to-talk микрофон открыт, пока вы удерживаете назначенную клавишу.</div>
      </div>

      <HotkeyRow
        action="push-to-talk"
        label="Push-to-talk"
        description="Удерживайте, чтобы открыть микрофон"
        ariaLabel="Клавиша Push-to-talk"
        disabled={microphoneMode !== 'push-to-talk'}
        {onPushToTalkOff}
      />
    </div>
  {/if}
</div>

<style>
  :global(.settings-sound-device-section) {
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  :global(.settings-gate) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 58px;
    align-items: center;
    gap: 14px;
  }
  :global(.settings-sound-value) {
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  :global(.settings-sound-actions) {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
  :global(.settings-sound-preview) {
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 10px;
    padding: 8px 12px;
    background: var(--control);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition:
      background 150ms ease,
      border-color 150ms ease;
  }
  :where(.settings-sound-preview):hover {
    background: var(--control-hover);
    border-color: rgba(255, 255, 255, 0.22);
  }
  :where(.settings-sound-preview):disabled {
    cursor: wait;
    opacity: 0.65;
  }
  :global(.settings-gate-value) {
    text-align: right;
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }
  :global(.settings-mode-toggle) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 4px;
    background: var(--warm-900);
  }
  :where(.settings-mode-toggle) button {
    min-height: 36px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--warm-muted);
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
  }
  :where(.settings-mode-toggle) button[aria-checked='true'] {
    background: color-mix(in oklch, var(--green) 16%, transparent);
    color: var(--warm-ink);
    box-shadow: inset 0 0 0 1px rgba(52, 201, 138, 0.28);
  }
</style>
