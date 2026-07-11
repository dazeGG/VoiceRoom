<script lang="ts">
  import { ImagePlus, LogOut, Mic, Trash2, User, X } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { changePassword, deleteUserAvatar, updateDisplayName, uploadUserAvatar } from '$lib/api/auth';
  import { isValidPassword, PASSWORD_MIN_LENGTH } from '$lib/features/auth/account';
  import { clearSession, setUser } from '$lib/features/auth/session.svelte';
  import { state as roomClientState } from '$lib/features/room/client/core/state.svelte';
  import { playPeerCue, playDirectMessageCue, playFriendAcceptedCue, playFriendRequestCue, playMicCue, playRoomChatMessageCue, playStreamCue, playStreamViewerCue } from '$lib/features/room/client/media/cues';
  import { Avatar, AvatarCropDialog, Select, Slider } from '$lib/shared/ui';
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
  import {
    notificationPreferences,
    requestNotificationsFromUiAction,
    syncNotificationPermission,
    updatePrivateNotifications
  } from '../model/notification-preferences.svelte';

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
  let avatarInput = $state<HTMLInputElement>();
  let avatarFile = $state<File | null>(null);
  let cropOpen = $state(false);
  let avatarSaving = $state(false);

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
  let notificationSaving = $state(false);

  const label = $derived(user?.displayName?.trim() || user?.login || '');

  const gateOpen = $derived(!gateOn || micLevelDb >= gateDb);
  // Only surface the live level while the gate is on — off means "don't capture
  // or show the mic level" (the meter effect below stops capturing too).
  const levelScale = $derived(gateOn ? gateMeterPosition(micLevelDb).toFixed(3) : '0');
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

    syncNotificationPermission();
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
    if (open && !cropOpen && event.key === 'Escape') onClose();
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
    avatarSaving = true;
    try {
      const nextUser = await uploadUserAvatar(blob);
      setUser(nextUser);
      syncLocalParticipantAvatar(nextUser);
      cropOpen = false;
      avatarFile = null;
      onToast('Аватар обновлён');
    } finally {
      avatarSaving = false;
    }
  }

  async function removeAvatar(): Promise<void> {
    if (avatarSaving || !user?.avatarUrl) return;
    avatarSaving = true;
    try {
      const nextUser = await deleteUserAvatar();
      setUser(nextUser);
      syncLocalParticipantAvatar(nextUser);
      onToast('Аватар удалён');
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось удалить аватар');
    } finally {
      avatarSaving = false;
    }
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

  async function requestBrowserNotifications(): Promise<void> {
    const permission = await requestNotificationsFromUiAction();
    if (permission === 'granted') onToast('Системные уведомления включены');
    else if (permission === 'denied') onToast('Разрешите уведомления в настройках браузера');
    else onToast('Системные уведомления недоступны');
  }

  async function togglePrivateNotifications(): Promise<void> {
    if (notificationSaving) return;
    notificationSaving = true;
    try {
      await updatePrivateNotifications(!notificationPreferences.privateNotifications);
      onToast('Настройки уведомлений сохранены');
    } catch {
      onToast('Не удалось сохранить настройки уведомлений');
    } finally {
      notificationSaving = false;
    }
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
    else if (kind === 'room-chat') playRoomChatMessageCue();
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
          </div>
          <button class="settings-nav-item settings-nav-item--danger" type="button" disabled={loggingOut} onclick={onLogout}>
            <LogOut {...iconMd} aria-hidden="true" />
            {loggingOut ? 'Выходим…' : 'Выйти'}
          </button>
        </nav>

        <div class="settings-content">
          {#if tab === 'profile'}
            <div class="settings-profile-head">
              <Avatar name={label} src={user?.avatarUrl} colorKey={user?.avatarColorKey} background={user?.avatarAccent || undefined} size={56} class="settings-profile-avatar" />
              <div>
                <div class="settings-profile-name">{label}</div>
                <div class="settings-profile-sub">@{user?.login}</div>
              </div>
            </div>

            <div class="settings-avatar-actions">
              <input bind:this={avatarInput} class="settings-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onchange={onAvatarFile} />
              <button type="button" class="settings-avatar-upload" onclick={chooseAvatar} disabled={avatarSaving}>
                <ImagePlus {...iconSm} aria-hidden="true" />
                {user?.avatarUrl ? 'Заменить аватар' : 'Загрузить аватар'}
              </button>
              {#if user?.avatarUrl}
                <button type="button" class="settings-avatar-delete" onclick={removeAvatar} disabled={avatarSaving} aria-label="Удалить аватар">
                  <Trash2 {...iconSm} aria-hidden="true" />
                  Удалить
                </button>
              {/if}
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


              <div>
                <div class="settings-gate-head">
                  <span class="settings-field-label">Системные уведомления</span>
                  <button
                    class="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={notificationPreferences.deliveryPermission === 'granted'}
                    aria-label="Системные уведомления"
                    onclick={() => void requestBrowserNotifications()}
                  >
                    <span class="settings-switch-knob" aria-hidden="true"></span>
                  </button>
                </div>
                <div class="settings-gate-hint">
                  {#if notificationPreferences.deliveryPermission === 'granted'}Включены. Новые ЛС, заявки и сообщения комнат могут появляться как системные уведомления.
                  {:else if notificationPreferences.browserPermission === 'denied'}Запрещены браузером — измените разрешение сайта в настройках браузера.
                  {:else}Нажмите переключатель, чтобы запросить разрешение. Запрос выполняется только по вашему действию.{/if}
                </div>
              </div>

              <div>
                <div class="settings-gate-head">
                  <span class="settings-field-label">Приватный текст уведомлений</span>
                  <button
                    class="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={notificationPreferences.privateNotifications}
                    aria-label="Приватный текст уведомлений"
                    disabled={notificationSaving}
                    onclick={() => void togglePrivateNotifications()}
                  >
                    <span class="settings-switch-knob" aria-hidden="true"></span>
                  </button>
                </div>
                <div class="settings-gate-hint">
                  Скрывает текст сообщений в системных уведомлениях.
                </div>
              </div>

              <div>
                <div class="settings-sound-head">
                  <span class="settings-field-label">Звуки интерфейса</span>
                  <output class="settings-sound-value">{Math.round(notificationVolume)}%</output>
                </div>
                <Slider
                  bind:value={notificationVolume}
                  min={0}
                  max={100}
                  defaultValue={100}
                  step={1}
                  ariaLabel="Звуки интерфейса"
                  ariaValueText={`${Math.round(notificationVolume)}%`}
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
                  <button type="button" onclick={() => previewCue('room-chat')}>Чат</button>
                  <button type="button" onclick={() => previewCue('dm')}>ЛС</button>
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
