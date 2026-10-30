<script setup lang="ts">
import { BellOff } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import { fetchBlockedUsers, unblockUser, type PublicUser } from '@/api/friends';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { showBrowserNotification } from '@/shared/notifications/router';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Avatar } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
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
const blockedUsers = ref<PublicUser[]>([]);
const blockedUsersLoading = ref(true);
const blockedUserSaving = ref('');

const browserNotificationsEnabled = computed(() =>
  pushNotifications.supported
    ? pushNotifications.active
    : notificationPreferences.notificationsEnabled && notificationPreferences.deliveryPermission === 'granted'
);
const notificationToggleLabel = computed(() =>
  props.support.desktopApp ? 'Уведомления приложения' : 'Push этого браузера'
);

onMounted(() => {
  void loadBlockedUsers();
});

function failure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function loadBlockedUsers(): Promise<void> {
  blockedUsersLoading.value = true;
  try {
    blockedUsers.value = await fetchBlockedUsers();
  } catch (error) {
    emit('toast', failure(error, 'Не удалось загрузить блокировки'), { variant: 'error' });
  } finally {
    blockedUsersLoading.value = false;
  }
}

async function unblockBlockedUser(userId: string): Promise<void> {
  if (blockedUserSaving.value) return;
  blockedUserSaving.value = userId;
  try {
    await unblockUser(userId);
    blockedUsers.value = blockedUsers.value.filter((entry) => entry.id !== userId);
    emit('toast', 'Пользователь разблокирован');
  } catch (error) {
    emit('toast', failure(error, 'Не удалось разблокировать'), { variant: 'error' });
  } finally {
    blockedUserSaving.value = '';
  }
}

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
          body: 'VoiceRoom сможет показывать уведомления, пока приложение открыто.',
          dedupeKey: `settings-notifications-enabled:${Date.now()}`,
          tag: 'settings-notifications-enabled',
          title: 'Уведомления VoiceRoom включены'
        });
      }
    } else if (permission === 'denied') emit('toast', 'Разрешите уведомления в настройках браузера');
    else emit('toast', 'Системные уведомления недоступны');
  } catch {
    emit(
      'toast',
      pushNotifications.serverEnabled
        ? 'Не удалось изменить push-уведомления'
        : 'Push-уведомления не настроены на сервере',
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
    emit('toast', 'Не удалось сохранить настройки уведомлений');
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
    'Не удалось изменить уведомления пользователя'
  );
}

function toggleRoomNotifications(roomId: string): Promise<void> {
  const muted = !notificationPreferences.mutedRoomIds.includes(roomId);
  return toggleTarget(
    `room:${roomId}`,
    () => preferences.updateRoomNotificationsMuted(roomId, muted),
    'Не удалось изменить уведомления комнаты'
  );
}
</script>

<template>
  <div class="settings__sound">
    <template v-if="!support.mac">
      <!-- The desktop app keeps this switch in «Приложение». -->
      <div :hidden="support.desktopApp && support.autostart">
        <div class="settings__gate-head">
          <span class="settings__field-label">{{ notificationToggleLabel }}</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="browserNotificationsEnabled"
            :aria-label="notificationToggleLabel"
            :disabled="pushNotifications.busy"
            @click="void toggleBrowserNotifications()"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">
          <template v-if="pushNotifications.supported && pushNotifications.active"
            >Включены. События будут доставляться, когда вкладка закрыта.</template
          >
          <template
            v-else-if="pushNotifications.supported && pushNotifications.loaded && !pushNotifications.serverEnabled"
            >Отключены на сервере: настройте VAPID-ключи.</template
          >
          <template v-else-if="support.desktopApp && notificationPreferences.deliveryPermission === 'granted'"
            >Включены для открытого приложения.</template
          >
          <template v-else-if="notificationPreferences.deliveryPermission === 'granted'"
            >Включены для открытой вкладки.</template
          >
          <template v-else-if="notificationPreferences.browserPermission === 'denied'"
            >Запрещены браузером — измените разрешение сайта.</template
          >
          <template v-else
            >Нажмите переключатель, чтобы включить. Запрос выполняется только по вашему действию.</template
          >
        </div>
      </div>

      <div
        class="settings__notification-dependent"
        :class="{ 'settings__notification-dependent--disabled': !browserNotificationsEnabled }"
      >
        <div class="settings__gate-head">
          <span class="settings__field-label">Приватный текст уведомлений</span>
          <button
            class="settings__switch"
            type="button"
            role="switch"
            :aria-checked="notificationPreferences.privateNotifications"
            aria-label="Приватный текст уведомлений"
            :disabled="notificationSaving || !browserNotificationsEnabled"
            @click="void togglePrivateNotifications()"
          >
            <span class="settings__switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings__gate-hint">Скрывает текст сообщений в системных уведомлениях.</div>
      </div>
    </template>

    <div class="settings__notification-ignore">
      <div>
        <span class="settings__section-title">Получать уведомления</span>
        <div class="settings__gate-hint">
          Выберите диалоги и комнаты, от которых хотите получать системные уведомления и звуковые сигналы.
        </div>
      </div>

      <div class="settings__notification-targets">
        <section class="settings__notification-group" aria-labelledby="notificationUsersTitle">
          <span id="notificationUsersTitle" class="settings__field-label">Пользователи</span>
          <div v-if="users.length > 0" class="settings__notification-list">
            <div v-for="peer in users" :key="peer.id" class="settings__notification-row">
              <Avatar
                :name="displayNameOf(peer)"
                :src="peer.avatarUrl"
                :color-key="peer.avatarColorKey"
                :background="peer.avatarAccent || undefined"
                :size="32"
              />
              <span class="settings__notification-name">
                <span class="settings__notification-title">
                  <strong><EmojiText :text="displayNameOf(peer)" /></strong>
                  <span
                    v-if="notificationPreferences.mutedPeerIds.includes(peer.id)"
                    class="settings__notification-muted"
                    role="img"
                    aria-label="Уведомления отключены"
                    title="Уведомления отключены"
                  >
                    <BellOff v-bind="iconSm" aria-hidden="true" />
                  </span>
                </span>
                <small>@{{ peer.login }}</small>
              </span>
              <button
                class="settings__switch"
                type="button"
                role="switch"
                :aria-checked="!notificationPreferences.mutedPeerIds.includes(peer.id)"
                :aria-label="`Получать уведомления от ${displayNameOf(peer)}`"
                :disabled="Boolean(notificationTargetSaving)"
                @click="void togglePeerNotifications(peer.id)"
              >
                <span class="settings__switch-knob" aria-hidden="true"></span>
              </button>
            </div>
          </div>
          <div v-else class="settings__notification-empty">Диалогов пока нет.</div>
        </section>

        <section class="settings__notification-group" aria-labelledby="notificationRoomsTitle">
          <span id="notificationRoomsTitle" class="settings__field-label">Комнаты</span>
          <div v-if="rooms.length > 0" class="settings__notification-list">
            <div v-for="room in rooms" :key="room.roomId" class="settings__notification-row">
              <Avatar
                :name="room.name?.trim() || room.roomId"
                :src="room.avatarUrl"
                shape="squircle"
                background="var(--vr-surface-3)"
                :size="32"
              />
              <span class="settings__notification-name">
                <span class="settings__notification-title">
                  <strong><EmojiText :text="room.name?.trim() || 'Комната'" /></strong>
                  <span
                    v-if="notificationPreferences.mutedRoomIds.includes(room.roomId)"
                    class="settings__notification-muted"
                    role="img"
                    aria-label="Уведомления отключены"
                    title="Уведомления отключены"
                  >
                    <BellOff v-bind="iconSm" aria-hidden="true" />
                  </span>
                </span>
                <small>{{ room.roomId }}</small>
              </span>
              <button
                class="settings__switch"
                type="button"
                role="switch"
                :aria-checked="!notificationPreferences.mutedRoomIds.includes(room.roomId)"
                :aria-label="`Получать уведомления комнаты ${room.name?.trim() || room.roomId}`"
                :disabled="Boolean(notificationTargetSaving)"
                @click="void toggleRoomNotifications(room.roomId)"
              >
                <span class="settings__switch-knob" aria-hidden="true"></span>
              </button>
            </div>
          </div>
          <div v-else class="settings__notification-empty">Сохранённых комнат пока нет.</div>
        </section>
      </div>
    </div>

    <section class="settings__notification-group settings__blocked-users" aria-labelledby="blockedUsersTitle">
      <div>
        <span id="blockedUsersTitle" class="settings__section-title">Заблокированные пользователи</span>
        <div class="settings__gate-hint">Разблокировка не восстанавливает дружбу и историю отношений.</div>
      </div>
      <div v-if="blockedUsersLoading" class="settings__notification-empty" role="status">Загружаем…</div>
      <div v-else-if="blockedUsers.length > 0" class="settings__notification-list">
        <div v-for="blocked in blockedUsers" :key="blocked.id" class="settings__notification-row">
          <Avatar
            :name="displayNameOf(blocked)"
            :src="blocked.avatarUrl"
            :color-key="blocked.avatarColorKey"
            :background="blocked.avatarAccent || undefined"
            :size="32"
          />
          <span class="settings__notification-name">
            <strong><EmojiText :text="displayNameOf(blocked)" /></strong>
            <small v-if="blocked.login">@{{ blocked.login }}</small>
          </span>
          <button
            class="settings__unblock-button"
            type="button"
            :disabled="Boolean(blockedUserSaving)"
            @click="void unblockBlockedUser(blocked.id)"
          >
            {{ blockedUserSaving === blocked.id ? 'Разблокируем…' : 'Разблокировать' }}
          </button>
        </div>
      </div>
      <div v-else class="settings__notification-empty">Заблокированных пользователей нет.</div>
    </section>
  </div>
</template>
