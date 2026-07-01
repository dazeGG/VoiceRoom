<script lang="ts">
  import type { AuthUser } from '$lib/api/auth';
  import { changePassword, updateDisplayName } from '$lib/api/auth';
  import { isValidPassword, PASSWORD_MIN_LENGTH } from '$lib/features/auth/account';
  import { clearSession, setUser } from '$lib/features/auth/session.svelte';
  import { playPeerCue, playDirectMessageCue, playFriendAcceptedCue, playFriendRequestCue, playMicCue, playStreamCue, playStreamViewerCue } from '$lib/features/room/client/media/cues';
  import { Select, Slider, VolumeSlider } from '$lib/shared/ui';
  import { getAvatarColor } from '$lib/visual/tokens';
  import {
    enumerateMicrophones,
    enumerateSpeakers,
    gateMeterPosition,
    gateValueLabel,
    isGateDisabled,
    NOISE_OPTIONS,
    persistGateThreshold,
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
  } from '../model/sound-settings';

  let {
    open,
    tab = $bindable('profile'),
    user,
    loggingOut = false,
    onClose,
    onToast,
    onLogout
  } = $props<{
    open: boolean;
    tab: 'profile' | 'sound';
    user: AuthUser | null;
    loggingOut?: boolean;
    onClose: () => void;
    onToast: (message: string) => void;
    onLogout: () => void;
  }>();

  // Default speaking-level threshold used when the gate is switched on from "off".
  const GATE_DEFAULT_DB = -40;

  // Profile form
  let name = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let saving = $state(false);

  // Sound form
  let microphones = $state<DeviceOption[]>([]);
  let speakers = $state<DeviceOption[]>([]);
  let micId = $state('');
  let speakerId = $state('');
  let noiseMode = $state('rnnoise');
  let gateOn = $state(false);
  let gateDb = $state(GATE_DEFAULT_DB);
  let micLevelDb = $state(GATE_THRESHOLD_MIN_DB);
  let notificationVolume = $state(100);

  const avatar = $derived(getAvatarColor(user?.avatarColorKey));
  const label = $derived(user?.displayName?.trim() || user?.login || '');
  const initials = $derived(
    (label
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.charAt(0))
      .join('')
      .toUpperCase() || label.charAt(0).toUpperCase()) || '·'
  );
  const avatarStyle = $derived(
    `background:${avatar.background};color:${avatar.foreground};box-shadow:${avatar.shadow}`
  );

  const gateOpen = $derived(!gateOn || micLevelDb >= gateDb);
  // Only surface the live level while the gate is on — off means "don't capture
  // or show the mic level" (the meter effect below stops capturing too).
  const levelScale = $derived(gateOn ? gateMeterPosition(micLevelDb).toFixed(3) : '0');
  const markerLeft = $derived(`${(gateMeterPosition(gateDb) * 100).toFixed(2)}%`);
  const gateLabel = $derived(gateOn ? gateValueLabel(gateDb) : 'Выкл');
  const microphoneOptions = $derived([
    { value: '', label: 'Системный' },
    ...microphones.map((mic) => ({ value: mic.deviceId, label: mic.label }))
  ]);
  const speakerOptions = $derived([
    { value: '', label: 'Системный' },
    ...speakers.map((speaker) => ({ value: speaker.deviceId, label: speaker.label }))
  ]);
  const noiseOptions = $derived(
    NOISE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
  );

  // Reset both forms whenever the modal (re)opens or the account changes.
  $effect(() => {
    if (!open) return;
    name = user?.displayName ?? '';
    currentPassword = '';
    newPassword = '';

    const sound = readSoundSettings();
    micId = sound.microphoneDeviceId;
    speakerId = sound.outputDeviceId;
    noiseMode = sound.noiseMode;
    gateOn = !isGateDisabled(sound.gateThresholdDb);
    gateDb = gateOn ? sound.gateThresholdDb : GATE_DEFAULT_DB;
    notificationVolume = sound.notificationVolume;
    void enumerateMicrophones().then((list) => (microphones = list));
    void enumerateSpeakers().then((list) => (speakers = list));
  });

  // Live mic meter — only while the Звук tab is visible AND the gate is on, so the
  // mic is captured solely to show the level for tuning the threshold, and is
  // released the moment the gate goes off, the tab changes, or the modal closes.
  $effect(() => {
    if (!(open && tab === 'sound' && gateOn)) return;
    const id = micId;
    let active = true;
    let meter: MicMeter | null = null;

    void startMicMeter(id, (db) => {
      if (active) micLevelDb = db;
    }).then((started) => {
      if (!active) {
        started?.stop();
        return;
      }
      meter = started;
      if (started) {
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
      meter?.stop();
      micLevelDb = GATE_THRESHOLD_MIN_DB;
    };
  });

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') onClose();
  }

  async function saveProfile(): Promise<void> {
    if (saving) return;
    // Snapshot before any await: updating the session re-runs the reset effect.
    const trimmedName = name.trim();
    const curPass = currentPassword;
    const nextPass = newPassword;
    const wantsRename = trimmedName !== (user?.displayName ?? '');
    const wantsPassword = curPass.length > 0 || nextPass.length > 0;

    if (!wantsRename && !wantsPassword) {
      onClose();
      return;
    }
    if (wantsPassword && !isValidPassword(nextPass)) {
      onToast(`Новый пароль: минимум ${PASSWORD_MIN_LENGTH} символов`);
      return;
    }

    saving = true;
    let renamed = false;
    try {
      if (wantsRename) {
        setUser(await updateDisplayName(trimmedName));
        renamed = true;
      }
      if (wantsPassword) {
        await changePassword(curPass, nextPass);
        currentPassword = '';
        newPassword = '';
        clearSession();
        onToast('Пароль изменён, войдите снова');
      } else {
        onToast('Изменения сохранены');
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Не удалось сохранить';
      onToast(renamed ? `Имя сохранено, пароль не изменён: ${message}` : message);
    } finally {
      saving = false;
    }
  }

  function onMicChange(value: string): void {
    micId = value;
    persistMicrophone(micId);
  }

  function onSpeakerChange(value: string): void {
    speakerId = value;
    persistSpeaker(speakerId);
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

  function onGateChange(value: number): void {
    gateDb = Math.round(value);
    if (gateOn) persistGate();
  }

  function onNotificationVolumeChange(value: number): void {
    notificationVolume = persistNotificationVolume(value);
  }

  function previewNotificationSound(): void {
    playPeerCue('join');
    window.setTimeout(() => playDirectMessageCue(), 180);
    window.setTimeout(() => playFriendRequestCue(), 360);
  }

  function previewCue(kind: string): void {
    if (kind === 'peer-leave') playPeerCue('leave');
    else if (kind === 'mute') playMicCue(true);
    else if (kind === 'unmute') playMicCue(false);
    else if (kind === 'stream-start') playStreamCue('start');
    else if (kind === 'stream-stop') playStreamCue('stop');
    else if (kind === 'stream-viewer') playStreamViewerCue('join');
    else if (kind === 'dm') playDirectMessageCue();
    else if (kind === 'friend-request') playFriendRequestCue();
    else if (kind === 'friend-accepted') playFriendAcceptedCue();
    else playPeerCue('join');
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="settings-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="settings-head">
        <span class="settings-title" id="settingsTitle">Настройки</span>
        <button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
        </button>
      </div>

      <div class="settings-body">
        <nav class="settings-nav" aria-label="Разделы настроек">
          <div class="settings-nav-main">
            <button class="settings-nav-item" type="button" data-active={tab === 'profile'} onclick={() => (tab = 'profile')}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>
              Профиль
            </button>
            <button class="settings-nav-item" type="button" data-active={tab === 'sound'} onclick={() => (tab = 'sound')}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M6 11 a6 6 0 0 0 12 0"></path><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8" y1="21" x2="16" y2="21"></line></svg>
              Звук
            </button>
          </div>
          <button class="settings-nav-item settings-nav-item--danger" type="button" disabled={loggingOut} onclick={onLogout}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            {loggingOut ? 'Выходим…' : 'Выйти'}
          </button>
        </nav>

        <div class="settings-content">
          {#if tab === 'profile'}
            <div class="settings-profile-head">
              <span class="settings-profile-avatar" style={avatarStyle} aria-hidden="true">{initials}</span>
              <div>
                <div class="settings-profile-name">{label}</div>
                <div class="settings-profile-sub">@{user?.login}</div>
              </div>
            </div>

            <div class="settings-fields">
              <div>
                <span class="settings-field-label">Имя</span>
                <input class="settings-input" bind:value={name} maxlength="40" autocomplete="nickname" />
              </div>

              <div class="settings-divider"></div>

              <div>
                <span class="settings-field-label">Текущий пароль</span>
                <input class="settings-input" type="password" bind:value={currentPassword} placeholder="••••••••" autocomplete="current-password" />
              </div>
              <div>
                <span class="settings-field-label">Новый пароль</span>
                <input class="settings-input" type="password" bind:value={newPassword} placeholder="Минимум {PASSWORD_MIN_LENGTH} символов" autocomplete="new-password" />
              </div>
            </div>

            <div class="settings-actions">
              <button class="settings-save" type="button" onclick={saveProfile} disabled={saving}>
                {#if saving}<span class="home-spinner" aria-hidden="true"></span>{/if}
                Сохранить
              </button>
              <button class="settings-cancel" type="button" onclick={onClose} disabled={saving}>Отмена</button>
            </div>
          {:else}
            <div class="settings-sound">
              <div>
                <span class="settings-field-label">Микрофон</span>
                <Select
                  bind:value={micId}
                  options={microphoneOptions}
                  label="Микрофон"
                  variant="field"
                  onValueChange={onMicChange}
                />
              </div>

              <div>
                <span class="settings-field-label">Динамик</span>
                <Select
                  bind:value={speakerId}
                  options={speakerOptions}
                  label="Динамик"
                  variant="field"
                  onValueChange={onSpeakerChange}
                />
              </div>

              <div>
                <span class="settings-field-label">Шумоподавление</span>
                <Select
                  bind:value={noiseMode}
                  options={noiseOptions}
                  label="Шумоподавление"
                  variant="field"
                  onValueChange={onNoiseChange}
                />
              </div>

              <div>
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

                <div class="settings-gate-body" data-disabled={!gateOn}>
                  <div class="settings-gate">
                    <div class="settings-gate-meter">
                      <span class="settings-gate-track" aria-hidden="true">
                        <span class="settings-gate-fill" data-state={gateOpen ? 'open' : 'closed'} style={`transform:scaleX(${levelScale})`}></span>
                        <span class="settings-gate-marker" data-active={gateOn} style={`left:${markerLeft}`}></span>
                      </span>
                      <div class="settings-gate-slider-wrap" data-disabled={!gateOn}>
                        <Slider
                          bind:value={gateDb}
                          min={GATE_THRESHOLD_MIN_DB}
                          max={GATE_THRESHOLD_MAX_DB}
                          step={1}
                          defaultValue={GATE_DEFAULT_DB}
                          disabled={!gateOn}
                          ariaLabel="Порог гейта в децибелах"
                          ariaValueText={gateLabel}
                          onValueChange={onGateChange}
                        />
                      </div>
                    </div>
                    <span class="settings-gate-value">{gateLabel}</span>
                  </div>
                  <div class="settings-gate-hint">
                    Микрофон открывается, только когда звук громче порога — отсекает фоновый шум и дыхание.
                  </div>
                </div>
              </div>

              <div>
                <VolumeSlider
                  bind:value={notificationVolume}
                  min={0}
                  max={100}
                  defaultValue={100}
                  step={1}
                  label="Звуки интерфейса"
                  snap={false}
                  onValueChange={onNotificationVolumeChange}
                />
                <div class="settings-sound-actions">
                  <button class="settings-sound-preview" type="button" onclick={previewNotificationSound}>
                    Проверить набор
                  </button>
                </div>
                <div class="settings-cue-grid" aria-label="Предпрослушивание событий">
                  <button type="button" onclick={() => previewCue('peer-join')}>Вход</button>
                  <button type="button" onclick={() => previewCue('peer-leave')}>Выход</button>
                  <button type="button" onclick={() => previewCue('mute')}>Mute</button>
                  <button type="button" onclick={() => previewCue('unmute')}>Unmute</button>
                  <button type="button" onclick={() => previewCue('stream-start')}>Стрим старт</button>
                  <button type="button" onclick={() => previewCue('stream-stop')}>Стрим стоп</button>
                  <button type="button" onclick={() => previewCue('stream-viewer')}>Зритель</button>
                  <button type="button" onclick={() => previewCue('dm')}>Сообщение</button>
                  <button type="button" onclick={() => previewCue('friend-request')}>Заявка</button>
                  <button type="button" onclick={() => previewCue('friend-accepted')}>Приняли</button>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
