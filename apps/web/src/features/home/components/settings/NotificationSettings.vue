<script setup lang="ts">
import { Switch, SettingRow, SettingsGroup, Avatar } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { BellOff } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import type { PublicUser } from '@/api/friends';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { showBrowserNotification } from '@/shared/notifications/router';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { displayNameOf } from '@/shared/utils/display-name';
import { usePushNotificationsStore } from '../../model/push-notifications.store';
import type { SettingsSupport } from '../../model/settings-support';
import type { ToastOptions } from '../../model/toasts.store';

const props = defineProps<{
  support: SettingsSupport;
  users: PublicUser[];
  rooms: OwnedRoom[];
}>();

const emit = defineEmits<{ toast: [message: string, options?: ToastOptions] }>();

const preferences = useNotificationPreferencesStore();
const { notificationPreferences } = preferences;
const pushNotifications = usePushNotificationsStore();

const notificationSaving = ref(false);
const notificationTargetSaving = ref('');

const browserNotificationsEnabled = computed(() =>
  pushNotifications.supported
    ? pushNotifications.active
    : notificationPreferences.notificationsEnabled && notificationPreferences.deliveryPermission === 'granted'
);
const notificationToggleLabel = computed(() =>
  props.support.desktopApp ? t('Уведомления приложения') : t('Push этого браузера')
);

async function toggleBrowserNotifications(): Promise<void> {
  try {
    if (pushNotifications.supported) {
      await pushNotifications.setPushNotificationsEnabled(!pushNotifications.active);
      preferences.syncNotificationPermission();
      return;
    }
    if (browserNotificationsEnabled.value) {
      preferences.setNotificationsEnabled(false);
      return;
    }
    const permission = await preferences.requestNotificationsFromUiAction();
    if (permission === 'granted') {
      if (props.support.desktopApp) {
        void showBrowserNotification({
          body: t('VoiceRoom сможет показывать уведомления, пока приложение открыто.'),
          dedupeKey: `settings-notifications-enabled:${Date.now()}`,
          tag: 'settings-notifications-enabled',
          title: t('Уведомления VoiceRoom включены')
        });
      }
    } else if (permission === 'denied') emit('toast', t('Разрешите уведомления в настройках браузера'));
    else emit('toast', t('Системные уведомления недоступны'));
  } catch {
    emit(
      'toast',
      pushNotifications.serverEnabled
        ? t('Не удалось изменить push-уведомления')
        : t('Push-уведомления не настроены на сервере'),
      { variant: 'error' }
    );
  }
}

async function togglePrivateNotifications(): Promise<void> {
  if (notificationSaving.value) return;
  notificationSaving.value = true;
  try {
    await preferences.updatePrivateNotifications(!notificationPreferences.privateNotifications);
  } catch {
    emit('toast', t('Не удалось сохранить настройки уведомлений'));
  } finally {
    notificationSaving.value = false;
  }
}

async function toggleTarget(key: string, save: () => Promise<unknown>, failureText: string): Promise<void> {
  if (notificationTargetSaving.value) return;
  notificationTargetSaving.value = key;
  try {
    await save();
  } catch {
    emit('toast', failureText);
  } finally {
    notificationTargetSaving.value = '';
  }
}

function togglePeerNotifications(userId: string): Promise<void> {
  const muted = !notificationPreferences.mutedPeerIds.includes(userId);
  return toggleTarget(
    `user:${userId}`,
    () => preferences.updatePeerNotificationsMuted(userId, muted),
    t('Не удалось изменить уведомления пользователя')
  );
}

function toggleRoomNotifications(roomId: string): Promise<void> {
  const muted = !notificationPreferences.mutedRoomIds.includes(roomId);
  return toggleTarget(
    `room:${roomId}`,
    () => preferences.updateRoomNotificationsMuted(roomId, muted),
    t('Не удалось изменить уведомления комнаты')
  );
}
</script>

<template>
  <div class="settings__sound">
    <SettingsGroup v-if="!support.mac">
      <!-- The desktop app keeps this switch in «Приложение». -->
      <SettingRow :hidden="support.desktopApp && support.autostart" :label="notificationToggleLabel">
        <template #description>
          <template v-if="pushNotifications.supported && pushNotifications.active">{{
            t('Включены. События будут доставляться, когда вкладка закрыта.')
          }}</template>
          <template
            v-else-if="pushNotifications.supported && pushNotifications.loaded && !pushNotifications.serverEnabled"
            >{{ t('Отключены на сервере: настройте VAPID-ключи.') }}</template
          >
          <template v-else-if="support.desktopApp && notificationPreferences.deliveryPermission === 'granted'">{{
            t('Включены для открытого приложения.')
          }}</template>
          <template v-else-if="notificationPreferences.deliveryPermission === 'granted'">{{
            t('Включены для открытой вкладки.')
          }}</template>
          <template v-else-if="notificationPreferences.browserPermission === 'denied'">{{
            t('Запрещены браузером — измените разрешение сайта.')
          }}</template>
          <template v-else>{{
            t('Нажмите переключатель, чтобы включить. Запрос выполняется только по вашему действию.')
          }}</template>

          <p
            v-if="pushNotifications.active && pushNotifications.localeSyncPending"
            class="settings__gate-hint"
            role="status"
          >
            {{ t('Язык приложения сохранён. Язык фоновых уведомлений обновится после синхронизации.') }}
          </p>
        </template>
        <template #control>
          <Switch
            :model-value="browserNotificationsEnabled"
            v-bind="{ ariaLabel: notificationToggleLabel }"
            :disabled="pushNotifications.busy"
            @update:model-value="void toggleBrowserNotifications()"
          />
        </template>
      </SettingRow>

      <SettingRow
        class="settings__notification-dependent"
        :class="{ 'settings__notification-dependent--disabled': !browserNotificationsEnabled }"
        :label="t('Приватный текст уведомлений')"
        :description="t('Скрывает текст сообщений в системных уведомлениях.')"
      >
        <template #control>
          <Switch
            :model-value="notificationPreferences.privateNotifications"
            v-bind="{ ariaLabel: t('Приватный текст уведомлений') }"
            :disabled="notificationSaving || !browserNotificationsEnabled"
            @update:model-value="void togglePrivateNotifications()"
          />
        </template>
      </SettingRow>
    </SettingsGroup>

    <div class="settings__notification-ignore">
      <div>
        <span class="settings__section-title">{{ t('Получать уведомления') }}</span>
        <div class="settings__gate-hint">
          {{ t('Выберите диалоги и комнаты, от которых хотите получать системные уведомления и звуковые сигналы.') }}
        </div>
      </div>

      <div class="settings__notification-targets">
        <SettingsGroup :heading="t('Пользователи')">
          <template v-if="users.length > 0">
            <SettingRow v-for="peer in users" :key="peer.id">
              <template #leading>
                <Avatar
                  :name="displayNameOf(peer)"
                  :src="peer.avatarUrl"
                  :color-key="peer.avatarColorKey"
                  :background="peer.avatarAccent || undefined"
                  :size="32"
                />
              </template>
              <template #title>
                <span class="settings__notification-title">
                  <EmojiText :text="displayNameOf(peer)" />
                  <span
                    v-if="notificationPreferences.mutedPeerIds.includes(peer.id)"
                    class="settings__notification-muted"
                    role="img"
                    :aria-label="t('Уведомления отключены')"
                    :title="t('Уведомления отключены')"
                  >
                    <BellOff v-bind="iconSm" aria-hidden="true" />
                  </span>
                </span>
              </template>
              <template #description>@{{ peer.login }}</template>
              <template #control>
                <Switch
                  :model-value="!notificationPreferences.mutedPeerIds.includes(peer.id)"
                  v-bind="{ ariaLabel: t('Получать уведомления от {p0}', { p0: displayNameOf(peer) }) }"
                  :disabled="Boolean(notificationTargetSaving)"
                  @update:model-value="void togglePeerNotifications(peer.id)"
                />
              </template>
            </SettingRow>
          </template>
          <div v-else class="settings__notification-empty">{{ t('Диалогов пока нет.') }}</div>
        </SettingsGroup>

        <SettingsGroup :heading="t('Комнаты')">
          <template v-if="rooms.length > 0">
            <SettingRow v-for="room in rooms" :key="room.roomId">
              <template #leading>
                <Avatar
                  :name="room.name?.trim() || room.roomId"
                  :src="room.avatarUrl"
                  shape="squircle"
                  background="var(--vr-surface-3)"
                  :size="32"
                />
              </template>
              <template #title>
                <span class="settings__notification-title">
                  <EmojiText :text="room.name?.trim() || t('Комната')" />
                  <span
                    v-if="notificationPreferences.mutedRoomIds.includes(room.roomId)"
                    class="settings__notification-muted"
                    role="img"
                    :aria-label="t('Уведомления отключены')"
                    :title="t('Уведомления отключены')"
                  >
                    <BellOff v-bind="iconSm" aria-hidden="true" />
                  </span>
                </span>
              </template>
              <template #description>{{ room.roomId }}</template>
              <template #control>
                <Switch
                  :model-value="!notificationPreferences.mutedRoomIds.includes(room.roomId)"
                  v-bind="{
                    ariaLabel: t('Получать уведомления комнаты {p0}', { p0: room.name?.trim() || room.roomId })
                  }"
                  :disabled="Boolean(notificationTargetSaving)"
                  @update:model-value="void toggleRoomNotifications(room.roomId)"
                />
              </template>
            </SettingRow>
          </template>
          <div v-else class="settings__notification-empty">{{ t('Сохранённых комнат пока нет.') }}</div>
        </SettingsGroup>
      </div>
    </div>
  </div>
</template>
