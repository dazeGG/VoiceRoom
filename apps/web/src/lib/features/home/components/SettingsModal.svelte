<script lang="ts">
  import { Bell, BellOff, Keyboard, LogOut, Mic, Pencil, User, X } from '@lucide/svelte';
  import { onDestroy, untrack } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { PublicUser } from '$lib/api/friends';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { changePassword, deleteUserAvatar, updateDisplayName, uploadUserAvatar } from '$lib/api/auth';
  import { isValidPassword, PASSWORD_MIN_LENGTH } from '$lib/features/auth/account';
  import { clearSession, setUser } from '$lib/features/auth/session.svelte';
  import { state as roomClientState } from '$lib/features/room/client/core/state.svelte';
  import { playPeerCue, playDirectMessageCue, playFriendAcceptedCue, playMicCue, playRoomChatMessageCue, playStreamCue } from '$lib/features/room/client/media/cues';
  import {
    Avatar,
    AvatarCropDialog,
    HotkeyRecorder,
    Select,
    Slider,
    type HotkeyBinding
  } from '$lib/shared/ui';
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
  } from '../model/sound-settings';
  import { syncAudioBusOutput, syncAudioBusSettings } from '$lib/features/room/client/services/audio-bus';
  import { setMicrophoneVolume } from '$lib/features/room/client/services/microphone-service';
  import { setMicrophoneMode } from '$lib/features/room/client/ui/controls';
  import {
    desktopGlobalHotkeysAvailable,
    setDesktopGlobalHotkeysSuspended
  } from '$lib/features/room/client/services/desktop-hotkey-service';
  import {
    getDefaultHotkeyBinding,
    readHotkeyBinding,
    writeHotkeyBinding,
    type HotkeyAction
  } from '$lib/features/room/client/core/hotkeys';
  import type { MicrophoneMode } from '$lib/features/room/client/core/config';
  import {
    notificationPreferences,
    requestNotificationsFromUiAction,
    setNotificationsEnabled,
    syncNotificationPermission,
    updatePeerNotificationsMuted,
    updatePrivateNotifications,
    updateRoomNotificationsMuted
  } from '$lib/shared/notifications/preferences.svelte';
  import { showBrowserNotification } from '$lib/shared/notifications/router';
  import {
    pushNotifications,
    setPushNotificationsEnabled,
    syncPushNotificationState
  } from '../model/push-notifications.svelte';
  import type { ToastOptions } from '../model/toasts.svelte';

  let {
    open,
    tab = $bindable('profile'),
    user,
    notificationUsers = [],
    notificationRooms = [],
    loggingOut = false,
    onClose,
    onToast,
    onLogout
  } = $props<{
    open: boolean;
    tab: 'profile' | 'sound' | 'hotkeys' | 'notifications';
    user: AuthUser | null;
    notificationUsers?: PublicUser[];
    notificationRooms?: OwnedRoom[];
    loggingOut?: boolean;
    onClose: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
    onLogout: () => void;
  }>();

  // Default speaking-level threshold used when the gate is switched on from "off".
  const GATE_DEFAULT_DB = -40;

  // Profile form
  let name = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let saving = $state(false);
  let avatarInput = $state<HTMLInputElement>();
  let avatarFile = $state<File | null>(null);
  let cropOpen = $state(false);
  let avatarSaving = $state(false);
  let pendingAvatar = $state<Blob | null>(null);
  let avatarPreviewUrl = $state('');
  let removeAvatarPending = $state(false);

  // Sound form
  let microphones = $state<DeviceOption[]>([]);
  let speakers = $state<DeviceOption[]>([]);
  let micId = $state('');
  let speakerId = $state('');
  let noiseMode = $state('rnnoise');
  let gateOn = $state(false);
  let gateDb = $state(GATE_DEFAULT_DB);
  let micLevelDb = $state(GATE_THRESHOLD_MIN_DB);
  let micVolume = $state(100);
  let microphoneMode = $state<MicrophoneMode>('open');
  let micMuteHotkey = $state<HotkeyBinding | null>(null);
  let outputMuteHotkey = $state<HotkeyBinding | null>(null);
  let pushToTalkHotkey = $state<HotkeyBinding | null>(null);
  let globalHotkeysAvailable = $state(false);
  let desktopApp = $state(false);
  let desktopPlatform = $state('');
  let masterVolume = $state(100);
  let notificationVolume = $state(100);
  let notificationSaving = $state(false);
  let notificationTargetSaving = $state('');
  let previewingSoundSet = $state(false);
  let confirmedSpeakerId = '';
  let speakerChangeGeneration = 0;
  let activeMicMeter: MicMeter | null = null;
  let latestMicVolume = 100;
  let soundPreviewTimers: number[] = [];

  const label = $derived(user?.displayName?.trim() || user?.login || '');

  const gateOpen = $derived(!gateOn || micLevelDb >= gateDb);
  // Only surface the live level while the gate is on — off means "don't capture
  // or show the mic level" (the meter effect below stops capturing too).
  const levelScale = $derived(gateOn ? gateMeterPosition(micLevelDb).toFixed(3) : '0');
  const gateLabel = $derived(gateOn ? gateValueLabel(gateDb) : 'Выкл');
  const browserNotificationsEnabled = $derived(
    !notificationPreferences.notificationsEnabled
      ? false
      : pushNotifications.supported
      ? pushNotifications.active
      : notificationPreferences.deliveryPermission === 'granted'
  );
  const macDesktopApp = $derived(desktopApp && desktopPlatform === 'darwin');
  const notificationToggleLabel = $derived(desktopApp ? 'Уведомления приложения' : 'Push этого браузера');
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

  $effect(() => {
    if (!open) return;
    desktopApp = Boolean(window.voiceRoomRuntime?.isDesktop);
    desktopPlatform = window.voiceRoomRuntime?.platform || '';
    globalHotkeysAvailable = desktopApp && desktopGlobalHotkeysAvailable();
  });

  // Reset both forms whenever the modal (re)opens or the account changes.
  $effect(() => {
    const isOpen = open;
    void user?.id;
    if (!isOpen) return;
    untrack(() => {
      name = user?.displayName ?? '';
      currentPassword = '';
      newPassword = '';
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      avatarPreviewUrl = '';
      pendingAvatar = null;
      removeAvatarPending = false;
    });

    syncNotificationPermission();
    void syncPushNotificationState(user?.id ?? null);
    const sound = readSoundSettings();
    micId = sound.microphoneDeviceId;
    speakerId = sound.outputDeviceId;
    confirmedSpeakerId = sound.outputDeviceId;
    noiseMode = sound.noiseMode;
    gateOn = !isGateDisabled(sound.gateThresholdDb);
    gateDb = gateOn ? sound.gateThresholdDb : GATE_DEFAULT_DB;
    micVolume = sound.microphoneVolume;
    latestMicVolume = sound.microphoneVolume;
    microphoneMode = sound.microphoneMode;
    micMuteHotkey = readHotkeyBinding('mic-mute');
    outputMuteHotkey = readHotkeyBinding('output-mute');
    pushToTalkHotkey = readHotkeyBinding('push-to-talk');
    masterVolume = sound.masterVolume;
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

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder-recording="true"]')) return;
    if (open && !cropOpen && event.key === 'Escape') onClose();
  }

  function stopSoundPreview(): void {
    for (const timer of soundPreviewTimers) window.clearTimeout(timer);
    soundPreviewTimers = [];
    previewingSoundSet = false;
  }

  $effect(() => {
    if (!open) untrack(stopSoundPreview);
  });

  onDestroy(stopSoundPreview);

  async function saveProfile(): Promise<void> {
    if (saving) return;
    // Snapshot before any await: updating the session re-runs the reset effect.
    const trimmedName = name.trim();
    const curPass = currentPassword;
    const nextPass = newPassword;
    const wantsRename = trimmedName !== (user?.displayName ?? '');
    const wantsPassword = curPass.length > 0 || nextPass.length > 0;
    const avatarBlob = pendingAvatar;
    const shouldRemoveAvatar = removeAvatarPending;
    const wantsAvatar = Boolean(avatarBlob) || shouldRemoveAvatar;

    if (!wantsRename && !wantsPassword && !wantsAvatar) {
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
      let nextUser = user;
      if (wantsRename) {
        nextUser = await updateDisplayName(trimmedName);
        setUser(nextUser);
        renamed = true;
      }
      if (avatarBlob) {
        nextUser = await uploadUserAvatar(avatarBlob);
        setUser(nextUser);
        syncLocalParticipantAvatar(nextUser);
      } else if (shouldRemoveAvatar) {
        nextUser = await deleteUserAvatar();
        setUser(nextUser);
        syncLocalParticipantAvatar(nextUser);
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

  function chooseAvatar(): void {
    avatarInput?.click();
  }

  function onAvatarFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selected = input.files?.[0] ?? null;
    input.value = '';
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      onToast('Выберите изображение JPEG, PNG или WebP');
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      onToast('Изображение должно быть меньше 5 МБ');
      return;
    }
    avatarFile = selected;
    cropOpen = true;
  }

  async function saveAvatar(blob: Blob): Promise<void> {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    pendingAvatar = blob;
    avatarPreviewUrl = URL.createObjectURL(blob);
    removeAvatarPending = false;
    cropOpen = false;
    avatarFile = null;
  }

  function removeAvatar(): void {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = '';
    pendingAvatar = null;
    removeAvatarPending = true;
  }

  function syncLocalParticipantAvatar(nextUser: AuthUser): void {
    if (!roomClientState.self?.isLocal) return;
    roomClientState.self.avatarAccent = nextUser.avatarAccent || '';
    roomClientState.self.avatarColorKey = nextUser.avatarColorKey || '';
    roomClientState.self.avatarUrl = nextUser.avatarUrl || '';
  }

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

  function changeHotkey(action: HotkeyAction, binding: HotkeyBinding | null): void {
    writeHotkeyBinding(action, binding);
    if (action === 'mic-mute') micMuteHotkey = binding;
    if (action === 'output-mute') outputMuteHotkey = binding;
    if (action === 'push-to-talk') {
      pushToTalkHotkey = binding;
      if (!binding && microphoneMode === 'push-to-talk') {
        microphoneMode = setMicrophoneMode('open');
        onToast('Push-to-talk выключен: клавиша не назначена');
      }
    }
  }

  async function toggleBrowserNotifications(): Promise<void> {
    try {
      if (pushNotifications.supported) {
        await setPushNotificationsEnabled(!pushNotifications.active);
        syncNotificationPermission();
        return;
      }
      if (browserNotificationsEnabled) {
        setNotificationsEnabled(false);
        return;
      }
      const permission = await requestNotificationsFromUiAction();
      if (permission === 'granted') {
        if (desktopApp) {
          void showBrowserNotification({
            body: 'Voice Room сможет показывать уведомления, пока приложение открыто.',
            dedupeKey: `settings-notifications-enabled:${Date.now()}`,
            tag: 'settings-notifications-enabled',
            title: 'Уведомления Voice Room включены'
          });
        }
      }
      else if (permission === 'denied') onToast('Разрешите уведомления в настройках браузера');
      else onToast('Системные уведомления недоступны');
    } catch {
      onToast(pushNotifications.serverEnabled
        ? 'Не удалось изменить push-уведомления'
        : 'Push-уведомления не настроены на сервере', { variant: 'error' });
    }
  }

  async function togglePrivateNotifications(): Promise<void> {
    if (notificationSaving) return;
    notificationSaving = true;
    try {
      await updatePrivateNotifications(!notificationPreferences.privateNotifications);
    } catch {
      onToast('Не удалось сохранить настройки уведомлений');
    } finally {
      notificationSaving = false;
    }
  }

  async function togglePeerNotifications(userId: string): Promise<void> {
    if (notificationTargetSaving) return;
    notificationTargetSaving = `user:${userId}`;
    try {
      const muted = !notificationPreferences.mutedPeerIds.includes(userId);
      await updatePeerNotificationsMuted(userId, muted);
    } catch {
      onToast('Не удалось изменить уведомления пользователя');
    } finally {
      notificationTargetSaving = '';
    }
  }

  async function toggleRoomNotifications(roomId: string): Promise<void> {
    if (notificationTargetSaving) return;
    notificationTargetSaving = `room:${roomId}`;
    try {
      const muted = !notificationPreferences.mutedRoomIds.includes(roomId);
      await updateRoomNotificationsMuted(roomId, muted);
    } catch {
      onToast('Не удалось изменить уведомления комнаты');
    } finally {
      notificationTargetSaving = '';
    }
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
      soundPreviewTimers.push(window.setTimeout(play, index * 620));
    });
    soundPreviewTimers.push(window.setTimeout(stopSoundPreview, cues.length * 620));
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="settings-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="settings-head">
        <span class="settings-title" id="settingsTitle">Настройки</span>
        <button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>

      <div class="settings-body">
        <nav class="settings-nav" aria-label="Разделы настроек">
          <div class="settings-nav-main">
            <button class="settings-nav-item" type="button" data-active={tab === 'profile'} onclick={() => (tab = 'profile')}>
              <User {...iconMd} aria-hidden="true" />
              Профиль
            </button>
            <button class="settings-nav-item" type="button" data-active={tab === 'sound'} onclick={() => (tab = 'sound')}>
              <Mic {...iconMd} aria-hidden="true" />
              Звук
            </button>
            {#if desktopApp}
              <button class="settings-nav-item" type="button" data-active={tab === 'hotkeys'} onclick={() => (tab = 'hotkeys')}>
                <Keyboard {...iconMd} aria-hidden="true" />
                Хоткеи
              </button>
            {/if}
            <button class="settings-nav-item" type="button" data-active={tab === 'notifications'} onclick={() => (tab = 'notifications')}>
              <Bell {...iconMd} aria-hidden="true" />
              Уведомления
            </button>
          </div>
          <button class="settings-nav-item settings-nav-item--danger" type="button" disabled={loggingOut} onclick={onLogout}>
            <LogOut {...iconMd} aria-hidden="true" />
            {loggingOut ? 'Выходим…' : 'Выйти'}
          </button>
        </nav>

        <div class="settings-content">
          {#if tab === 'profile'}
            <div class="settings-profile-head">
              <div class="settings-avatar-control">
                <input bind:this={avatarInput} class="settings-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onchange={onAvatarFile} />
                <button
                  type="button"
                  class="settings-avatar-edit"
                  onclick={chooseAvatar}
                  disabled={avatarSaving}
                  aria-label={user?.avatarUrl ? 'Изменить аватар' : 'Загрузить аватар'}
                  title={user?.avatarUrl ? 'Изменить аватар' : 'Загрузить аватар'}
                >
                  <Avatar name={label} src={avatarPreviewUrl || (removeAvatarPending ? null : user?.avatarUrl)} colorKey={user?.avatarColorKey} background={user?.avatarAccent || undefined} size={56} class="settings-profile-avatar" />
                  <span class="settings-avatar-overlay" aria-hidden="true">
                    <Pencil {...iconSm} />
                  </span>
                </button>
                {#if avatarPreviewUrl || (user?.avatarUrl && !removeAvatarPending)}
                  <button
                    type="button"
                    class="settings-avatar-remove"
                    onclick={removeAvatar}
                    disabled={avatarSaving}
                    aria-label="Удалить аватар"
                    title="Удалить аватар"
                  >
                    <X {...iconSm} aria-hidden="true" />
                  </button>
                {/if}
              </div>
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

              <div class="settings-password-fields">
                <div>
                  <span class="settings-field-label">Текущий пароль</span>
                  <input class="settings-input" type="password" bind:value={currentPassword} placeholder="••••••••" autocomplete="current-password" />
                </div>
                <div>
                  <span class="settings-field-label">Новый пароль</span>
                  <input class="settings-input" type="password" bind:value={newPassword} placeholder="Минимум {PASSWORD_MIN_LENGTH} символов" autocomplete="new-password" />
                </div>
              </div>
            </div>

            <div class="settings-actions">
              <button class="settings-cancel" type="button" onclick={onClose} disabled={saving}>Отмена</button>
              <button class="settings-save" type="button" onclick={saveProfile} disabled={saving}>
                {#if saving}<span class="home-spinner" aria-hidden="true"></span>{/if}
                Сохранить
              </button>
            </div>
          {:else if tab === 'sound'}
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

                    <div class="settings-gate-body" data-disabled={!gateOn}>
                      <div class="settings-gate">
                        <Slider
                          bind:value={gateDb}
                          min={GATE_THRESHOLD_MIN_DB}
                          max={GATE_THRESHOLD_MAX_DB}
                          step={1}
                          defaultValue={GATE_DEFAULT_DB}
                          disabled={!gateOn}
                          showFill={false}
                          ariaLabel="Порог гейта в децибелах"
                          ariaValueText={gateLabel}
                          onValueChange={onGateChange}
                        >
                          {#snippet background()}
                            <span class="settings-gate-fill" data-state={gateOpen ? 'open' : 'closed'} style={`transform:scaleX(${levelScale})`}></span>
                          {/snippet}
                        </Slider>
                        <span class="settings-gate-value">{gateLabel}</span>
                      </div>
                      <div class="settings-gate-hint">
                        Микрофон открывается, только когда звук громче порога — отсекает фоновый шум и дыхание.
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
                      <button class="settings-sound-preview" type="button" disabled={previewingSoundSet} onclick={previewNotificationSound}>
                        {previewingSoundSet ? 'Проверяем…' : 'Проверить набор'}
                      </button>
                    </div>
                  </div>
                </section>
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
                        onclick={() => changeMicrophoneMode('open')}
                      >Открытый микрофон</button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={microphoneMode === 'push-to-talk'}
                        onclick={() => changeMicrophoneMode('push-to-talk')}
                      >Push-to-talk</button>
                    </div>
                    <div class="settings-gate-hint">В Push-to-talk микрофон открыт, пока вы удерживаете назначенную клавишу.</div>
                  </div>

                  <div class="settings-hotkey-row" data-disabled={microphoneMode !== 'push-to-talk'}>
                    <div>
                      <span class="settings-hotkey-label">Push-to-talk</span>
                      <span class="settings-hotkey-description">Удерживайте, чтобы открыть микрофон</span>
                    </div>
                    <HotkeyRecorder
                      bind:value={pushToTalkHotkey}
                      defaultValue={getDefaultHotkeyBinding('push-to-talk')}
                      disabled={microphoneMode !== 'push-to-talk'}
                      ariaLabel="Клавиша Push-to-talk"
                      onRecordingChange={(recording) => void setDesktopGlobalHotkeysSuspended(recording)}
                      onValueChange={(value) => changeHotkey('push-to-talk', value)}
                    />
                  </div>
                </div>
              {/if}
            </div>
          {:else if tab === 'hotkeys' && desktopApp}
            <div class="settings-hotkeys">
              <div>
                <span class="settings-section-title">Горячие клавиши</span>
                <div class="settings-gate-hint">Назначенные сочетания работают глобально в desktop-приложении, пока вы подключены к голосу.</div>
              </div>

              <div class="settings-hotkey-list">
                <div class="settings-hotkey-row">
                  <div>
                    <span class="settings-hotkey-label">Мьют микрофона</span>
                    <span class="settings-hotkey-description">Включить или выключить микрофон</span>
                  </div>
                  <HotkeyRecorder
                    bind:value={micMuteHotkey}
                    defaultValue={getDefaultHotkeyBinding('mic-mute')}
                    ariaLabel="Хоткей мьюта микрофона"
                    onRecordingChange={(recording) => void setDesktopGlobalHotkeysSuspended(recording)}
                    onValueChange={(value) => changeHotkey('mic-mute', value)}
                  />
                </div>
                <div class="settings-hotkey-row">
                  <div>
                    <span class="settings-hotkey-label">Мьют звука</span>
                    <span class="settings-hotkey-description">Заглушить весь вывод и микрофон</span>
                  </div>
                  <HotkeyRecorder
                    bind:value={outputMuteHotkey}
                    defaultValue={getDefaultHotkeyBinding('output-mute')}
                    ariaLabel="Хоткей мьюта звука"
                    onRecordingChange={(recording) => void setDesktopGlobalHotkeysSuspended(recording)}
                    onValueChange={(value) => changeHotkey('output-mute', value)}
                  />
                </div>
                <div class="settings-hotkey-row">
                  <div>
                    <span class="settings-hotkey-label">Push-to-talk</span>
                    <span class="settings-hotkey-description">Удерживайте, чтобы открыть микрофон</span>
                  </div>
                  <HotkeyRecorder
                    bind:value={pushToTalkHotkey}
                    defaultValue={getDefaultHotkeyBinding('push-to-talk')}
                    ariaLabel="Клавиша Push-to-talk"
                    onRecordingChange={(recording) => void setDesktopGlobalHotkeysSuspended(recording)}
                    onValueChange={(value) => changeHotkey('push-to-talk', value)}
                  />
                </div>
              </div>
              <div class="settings-hotkey-window-note">
                {#if globalHotkeysAvailable}
                  В приложении VoiceRoom успешно зарегистрированные сочетания работают поверх других окон, пока вы подключены к голосу. На macOS может потребоваться разрешение «Мониторинг ввода».
                {:else}
                  Системные сочетания недоступны в этой сборке приложения.
                {/if}
              </div>
            </div>
          {:else}
            <div class="settings-sound">
              {#if !macDesktopApp}
                <div>
                  <div class="settings-gate-head">
                    <span class="settings-field-label">{notificationToggleLabel}</span>
                    <button
                      class="settings-switch"
                      type="button"
                      role="switch"
                      aria-checked={browserNotificationsEnabled}
                      aria-label={notificationToggleLabel}
                      disabled={pushNotifications.busy}
                      onclick={() => void toggleBrowserNotifications()}
                    >
                      <span class="settings-switch-knob" aria-hidden="true"></span>
                    </button>
                  </div>
                  <div class="settings-gate-hint">
                    {#if pushNotifications.supported && pushNotifications.active}Включены. События будут доставляться, когда вкладка закрыта.
                    {:else if pushNotifications.supported && pushNotifications.loaded && !pushNotifications.serverEnabled}Отключены на сервере: настройте VAPID-ключи.
                    {:else if desktopApp && notificationPreferences.deliveryPermission === 'granted'}Включены для открытого приложения.
                    {:else if notificationPreferences.deliveryPermission === 'granted'}Включены для открытой вкладки.
                    {:else if notificationPreferences.browserPermission === 'denied'}Запрещены браузером — измените разрешение сайта.
                    {:else}Нажмите переключатель, чтобы включить. Запрос выполняется только по вашему действию.{/if}
                  </div>
                </div>

                <div class="settings-notification-dependent" data-disabled={!browserNotificationsEnabled}>
                  <div class="settings-gate-head">
                    <span class="settings-field-label">Приватный текст уведомлений</span>
                    <button
                      class="settings-switch"
                      type="button"
                      role="switch"
                      aria-checked={notificationPreferences.privateNotifications}
                      aria-label="Приватный текст уведомлений"
                      disabled={notificationSaving || !browserNotificationsEnabled}
                      onclick={() => void togglePrivateNotifications()}
                    >
                      <span class="settings-switch-knob" aria-hidden="true"></span>
                    </button>
                  </div>
                  <div class="settings-gate-hint">Скрывает текст сообщений в системных уведомлениях.</div>
                </div>
              {/if}

              <div class="settings-notification-ignore">
                <div>
                  <span class="settings-section-title">Получать уведомления</span>
                  <div class="settings-gate-hint">Выберите диалоги и комнаты, от которых хотите получать системные уведомления и звуковые сигналы.</div>
                </div>

                <div class="settings-notification-targets">
                <section class="settings-notification-group" aria-labelledby="notificationUsersTitle">
                  <span class="settings-field-label" id="notificationUsersTitle">Пользователи</span>
                  {#if notificationUsers.length > 0}
                    <div class="settings-notification-list">
                      {#each notificationUsers as peer (peer.id)}
                        {@const peerMuted = notificationPreferences.mutedPeerIds.includes(peer.id)}
                        <div class="settings-notification-row">
                          <Avatar
                            name={peer.displayName?.trim() || peer.login}
                            src={peer.avatarUrl}
                            colorKey={peer.avatarColorKey}
                            background={peer.avatarAccent || undefined}
                            size={32}
                          />
                          <span class="settings-notification-name">
                            <span class="settings-notification-title">
                              <strong>{peer.displayName?.trim() || peer.login}</strong>
                              {#if peerMuted}
                                <span class="settings-notification-muted" role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
                                  <BellOff {...iconSm} aria-hidden="true" />
                                </span>
                              {/if}
                            </span>
                            <small>@{peer.login}</small>
                          </span>
                          <button
                            class="settings-switch"
                            type="button"
                            role="switch"
                            aria-checked={!peerMuted}
                            aria-label={`Получать уведомления от ${peer.displayName?.trim() || peer.login}`}
                            disabled={Boolean(notificationTargetSaving)}
                            onclick={() => void togglePeerNotifications(peer.id)}
                          >
                            <span class="settings-switch-knob" aria-hidden="true"></span>
                          </button>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="settings-notification-empty">Диалогов пока нет.</div>
                  {/if}
                </section>

                <section class="settings-notification-group" aria-labelledby="notificationRoomsTitle">
                  <span class="settings-field-label" id="notificationRoomsTitle">Комнаты</span>
                  {#if notificationRooms.length > 0}
                    <div class="settings-notification-list">
                      {#each notificationRooms as room (room.roomId)}
                        {@const roomMuted = notificationPreferences.mutedRoomIds.includes(room.roomId)}
                        <div class="settings-notification-row">
                          <Avatar name={room.name?.trim() || room.roomId} src={room.avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={32} />
                          <span class="settings-notification-name">
                            <span class="settings-notification-title">
                              <strong>{room.name?.trim() || 'Комната'}</strong>
                              {#if roomMuted}
                                <span class="settings-notification-muted" role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
                                  <BellOff {...iconSm} aria-hidden="true" />
                                </span>
                              {/if}
                            </span>
                            <small>{room.roomId}</small>
                          </span>
                          <button
                            class="settings-switch"
                            type="button"
                            role="switch"
                            aria-checked={!roomMuted}
                            aria-label={`Получать уведомления комнаты ${room.name?.trim() || room.roomId}`}
                            disabled={Boolean(notificationTargetSaving)}
                            onclick={() => void toggleRoomNotifications(room.roomId)}
                          >
                            <span class="settings-switch-knob" aria-hidden="true"></span>
                          </button>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="settings-notification-empty">Сохранённых комнат пока нет.</div>
                  {/if}
                </section>
                </div>
              </div>

            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<AvatarCropDialog
  open={cropOpen}
  file={avatarFile}
  name={label}
  shape="circle"
  kind="user"
  title="Аватар профиля"
  onClose={() => {
    if (!avatarSaving) {
      cropOpen = false;
      avatarFile = null;
    }
  }}
  onSave={saveAvatar}
/>
