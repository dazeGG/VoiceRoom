<script setup lang="ts">
import { t } from '@/shared/i18n';
import { X } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import {
  readDesktopAutostartSettings,
  updateDesktopAutostartSettings,
  type DesktopAutostartPatch,
  type DesktopAutostartSettings
} from '@/platform/desktop-autostart';
import {
  addDesktopOverlayGame,
  readDesktopOverlayForeground,
  readDesktopOverlaySettings,
  removeDesktopOverlayGame,
  updateDesktopOverlaySettings,
  type DesktopOverlayForeground,
  type DesktopOverlayPatch,
  type DesktopOverlaySettings,
  isOverlayAnchor,
  isOverlayAvatarSize,
  type OverlayAnchor,
  type OverlayAvatarSize
} from '@/platform/desktop-overlay';
import { copyDesktopDiagnostics, openDesktopLogsFolder } from '@/platform/desktop-diagnostics';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { Select } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import type { SettingsSupport } from '../../model/settings-support';
import type { ToastOptions } from '../../model/toasts.store';

const props = defineProps<{ support: SettingsSupport }>();

const emit = defineEmits<{ toast: [message: string, options?: ToastOptions] }>();

const FOREGROUND_POLL_MS = 1000;

const preferences = useNotificationPreferencesStore();
const { notificationPreferences } = preferences;

const autostartSupported = ref(false);
const openAtLogin = ref(false);
const startMinimized = ref(false);
const autostartSaving = ref(false);
const overlayEnabled = ref(true);
const overlayAnchor = ref<OverlayAnchor>('top-left');
const overlayAvatarSize = ref<OverlayAvatarSize>('medium');
const overlayShowNames = ref(true);
const overlaySaving = ref(false);
let overlayPending: DesktopOverlayPatch | null = null;
const overlayAllowed = ref<string[]>([]);
const overlayForeground = ref<DesktopOverlayForeground | null>(null);

const systemNotificationsEnabled = computed(
  () => notificationPreferences.notificationsEnabled && notificationPreferences.deliveryPermission === 'granted'
);

onMounted(() => {
  if (props.support.autostart) void loadAutostartSettings();
  if (props.support.overlay) void loadOverlaySettings();
});

// The window the player last switched from, so it can be added as a game.
watch(
  () => props.support.overlay,
  (overlay, _before, onCleanup) => {
    if (!overlay) return;
    let cancelled = false;
    async function poll(): Promise<void> {
      const next = await readDesktopOverlayForeground();
      if (!cancelled) overlayForeground.value = next;
    }
    void poll();
    const timer = window.setInterval(() => void poll(), FOREGROUND_POLL_MS);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(timer);
    });
  },
  { immediate: true }
);

async function openLogsFolder(): Promise<void> {
  if (!(await openDesktopLogsFolder())) emit('toast', t('Не удалось открыть папку логов'), { variant: 'error' });
}

async function copyDiagnostics(): Promise<void> {
  if (await copyDesktopDiagnostics()) emit('toast', t('Скопировано'));
  else emit('toast', t('Не удалось скопировать информацию о системе'), { variant: 'error' });
}

function applyAutostartSettings(settings: DesktopAutostartSettings): void {
  autostartSupported.value = settings.supported;
  openAtLogin.value = settings.openAtLogin;
  startMinimized.value = settings.startMinimized;
}

async function loadAutostartSettings(): Promise<void> {
  const settings = await readDesktopAutostartSettings();
  if (settings) applyAutostartSettings(settings);
}

function applyOverlaySettings(settings: DesktopOverlaySettings): void {
  overlayEnabled.value = settings.enabled;
  overlayAnchor.value = settings.anchor;
  overlayAvatarSize.value = settings.avatarSize;
  overlayShowNames.value = settings.showNames;
  overlayAllowed.value = settings.allowedExecutables;
}

async function loadOverlaySettings(): Promise<void> {
  const settings = await readDesktopOverlaySettings();
  if (settings) applyOverlaySettings(settings);
}

// Changes can arrive while one is still saving. Merge them so the last value always
// lands, and only sync the UI back once nothing is queued.
async function changeOverlay(patch: DesktopOverlayPatch): Promise<void> {
  overlayPending = { ...(overlayPending ?? {}), ...patch };
  if (overlaySaving.value) return;
  overlaySaving.value = true;
  try {
    while (overlayPending) {
      const next: DesktopOverlayPatch = overlayPending;
      overlayPending = null;
      const settings = await updateDesktopOverlaySettings(next);
      if (!settings) {
        emit('toast', t('Не удалось сохранить оверлей'), { variant: 'error' });
        if (!overlayPending) await loadOverlaySettings();
        continue;
      }
      if (!overlayPending) applyOverlaySettings(settings);
    }
  } finally {
    overlaySaving.value = false;
  }
}

function executableName(exe: string): string {
  return exe.split(/[\\/]/).pop() || exe;
}

async function addOverlayGame(): Promise<void> {
  const settings = await addDesktopOverlayGame(overlayForeground.value?.exe);
  if (settings) applyOverlaySettings(settings);
  else emit('toast', t('Не удалось добавить игру'), { variant: 'error' });
}

async function removeOverlayGame(exe: string): Promise<void> {
  const settings = await removeDesktopOverlayGame(exe);
  if (settings) applyOverlaySettings(settings);
  else emit('toast', t('Не удалось убрать игру'), { variant: 'error' });
}

async function changeAutostart(patch: DesktopAutostartPatch): Promise<void> {
  if (autostartSaving.value) return;
  autostartSaving.value = true;
  try {
    const settings = await updateDesktopAutostartSettings(patch);
    if (settings) applyAutostartSettings(settings);
    if (!settings || settings.reason) emit('toast', t('Не удалось изменить автозапуск'), { variant: 'error' });
  } finally {
    autostartSaving.value = false;
  }
}

// Turns the OS notification toasts on or off for this device. In-app cues and
// the unread badge are unaffected.
async function toggleSystemNotifications(): Promise<void> {
  if (systemNotificationsEnabled.value) {
    preferences.setNotificationsEnabled(false);
    return;
  }
  const permission = await preferences.requestNotificationsFromUiAction();
  if (permission !== 'granted') emit('toast', t('Системные уведомления недоступны'), { variant: 'error' });
}
</script>

<template>
  <div class="settings__sound">
    <template v-if="support.overlay">
      <div>
        <div class="settings__gate-head">
          <span class="settings__field-label">{{ t('Оверлей в игре') }}</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="overlayEnabled"
            :aria-label="t('Оверлей в игре')"
            :disabled="overlaySaving"
            @click="void changeOverlay({ enabled: !overlayEnabled })"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">
          {{ t('Панель только поверх') }} <strong>{{ t('игры') }}</strong>
          {{
            t(
              'в оконном или borderless режиме: Steam, Epic, Riot, Xbox и то, что вы добавите ниже. Браузер, проводник и лаунчеры не считаются игрой. В exclusive fullscreen Windows отдаёт монитор игре — оверлея там не будет.'
            )
          }}
        </div>
      </div>

      <div
        class="settings__notification-dependent"
        :class="{ 'settings__notification-dependent--disabled': !overlayEnabled }"
      >
        <span class="settings__field-label">{{ t('Положение') }}</span>
        <Select
          v-model="overlayAnchor"
          :options="[
            { value: 'top-left', label: t('Слева сверху') },
            { value: 'top-right', label: t('Справа сверху') },
            { value: 'bottom-left', label: t('Слева снизу') },
            { value: 'bottom-right', label: t('Справа снизу') }
          ]"
          :label="t('Положение оверлея')"
          variant="field"
          :disabled="overlaySaving || !overlayEnabled"
          @value-change="
            (value: string) => {
              if (isOverlayAnchor(value)) void changeOverlay({ anchor: value });
            }
          "
        />
      </div>

      <div
        class="settings__notification-dependent"
        :class="{ 'settings__notification-dependent--disabled': !overlayEnabled }"
      >
        <span class="settings__field-label">{{ t('Размер аватаров') }}</span>
        <Select
          v-model="overlayAvatarSize"
          :options="[
            { value: 'small', label: t('Маленькие') },
            { value: 'medium', label: t('Средние') },
            { value: 'large', label: t('Большие') }
          ]"
          :label="t('Размер аватаров в оверлее')"
          variant="field"
          :disabled="overlaySaving || !overlayEnabled"
          @value-change="
            (value: string) => {
              if (isOverlayAvatarSize(value)) void changeOverlay({ avatarSize: value });
            }
          "
        />
      </div>

      <div
        class="settings__notification-dependent"
        :class="{ 'settings__notification-dependent--disabled': !overlayEnabled }"
      >
        <div class="settings__gate-head">
          <span class="settings__field-label">{{ t('Имена участников') }}</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="overlayShowNames"
            :aria-label="t('Имена участников')"
            :disabled="overlaySaving || !overlayEnabled"
            @click="void changeOverlay({ showNames: !overlayShowNames })"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">{{ t('Если выключить, в игре останутся только аватары.') }}</div>
      </div>

      <section
        class="settings__overlay-games"
        :class="{ 'settings__overlay-games--disabled': !overlayEnabled }"
        aria-labelledby="overlayGamesTitle"
      >
        <span id="overlayGamesTitle" class="settings__field-label">{{ t('Последнее окно') }}</span>
        <div class="settings__overlay-window">
          <template v-if="overlayForeground?.exe">
            <div class="settings__overlay-window-text">
              <span class="settings__overlay-window-name">{{
                overlayForeground.title || overlayForeground.label
              }}</span>
              <span class="settings__overlay-window-exe">{{ overlayForeground.label }}</span>
            </div>
            <span v-if="overlayForeground.game" class="settings__overlay-window-status">{{ t('Игра') }}</span>
            <button
              v-else
              class="settings__overlay-add"
              type="button"
              :disabled="overlaySaving || !overlayEnabled"
              @click="void addOverlayGame()"
            >
              {{ t('Добавить как игру') }}
            </button>
          </template>
          <span v-else class="settings__overlay-window-empty">{{
            t('Переключитесь в игру и вернитесь сюда — здесь появится её окно.')
          }}</span>
        </div>
        <ul v-if="overlayAllowed.length" class="settings__overlay-allowed" :aria-label="t('Игры, добавленные вручную')">
          <li v-for="exe in overlayAllowed" :key="exe" class="settings__overlay-allowed-item" :title="exe">
            <span>{{ executableName(exe) }}</span>
            <button
              class="settings__overlay-remove"
              type="button"
              :aria-label="t('Убрать {p0}', { p0: executableName(exe) })"
              :disabled="overlaySaving || !overlayEnabled"
              @click="void removeOverlayGame(exe)"
            >
              <X v-bind="iconSm" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>
    </template>

    <template v-if="support.autostart">
      <div>
        <div class="settings__gate-head">
          <span class="settings__field-label">{{ t('Автозапуск') }}</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="openAtLogin"
            :aria-label="t('Автозапуск')"
            :disabled="autostartSaving || !autostartSupported"
            @click="void changeAutostart({ openAtLogin: !openAtLogin })"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">
          <template v-if="autostartSupported">{{ t('VoiceRoom откроется при входе в систему.') }}</template>
          <template v-else>{{ t('Автозапуск недоступен в этой сборке приложения.') }}</template>
        </div>
      </div>

      <div
        class="settings__notification-dependent"
        :class="{ 'settings__notification-dependent--disabled': !openAtLogin }"
      >
        <div class="settings__gate-head">
          <span class="settings__field-label">{{ t('Автозапуск свёрнутым') }}</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="startMinimized"
            :aria-label="t('Автозапуск свёрнутым')"
            :disabled="autostartSaving || !autostartSupported || !openAtLogin"
            @click="void changeAutostart({ startMinimized: !startMinimized })"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">
          <template v-if="support.mac">{{
            t('При автозапуске окно не откроется — VoiceRoom будет ждать в Dock.')
          }}</template>
          <template v-else>{{ t('При автозапуске окно не откроется — VoiceRoom будет ждать в трее.') }}</template>
        </div>
      </div>

      <div v-if="!support.mac">
        <div class="settings__gate-head">
          <span class="settings__field-label">{{ t('Системные уведомления') }}</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="systemNotificationsEnabled"
            :aria-label="t('Системные уведомления')"
            @click="void toggleSystemNotifications()"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">
          {{
            t(
              'Уведомления Windows о сообщениях и заявках в друзья, без системного звука. Звуки VoiceRoom и счётчик на панели задач от этого не зависят.'
            )
          }}
        </div>
      </div>
    </template>

    <div v-if="support.diagnostics">
      <span class="settings__field-label">{{ t('Диагностика') }}</span>
      <div class="settings__gate-hint">
        {{ t('Логи и сведения о системе помогут поддержке разобраться с проблемой.') }}
      </div>
      <div class="settings__diagnostics-actions">
        <button class="settings__unblock-button" type="button" @click="void openLogsFolder()">
          {{ t('Открыть папку логов') }}
        </button>
        <button class="settings__unblock-button" type="button" @click="void copyDiagnostics()">
          {{ t('Скопировать информацию о системе') }}
        </button>
      </div>
    </div>
  </div>
</template>
