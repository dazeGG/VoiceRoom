<script setup lang="ts">
import {
  Tooltip,
  IconButton,
  Avatar,
  DropdownMenu,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  Pressable
} from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { Bell, LayoutDashboard, Settings } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { AuthUser } from '@/api/auth';
import EmojiText from '@/shared/chat/EmojiText.vue';
import BetaMark from '@/shared/components/BetaMark.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { normalizePresenceStatus, type PresenceStatus } from '@/shared/presence';
import { displayNameOf } from '@/shared/utils/display-name';
import type { ActiveVoice } from '../../model/active-voice';
import type { FriendMenuTarget } from '../../model/friend-menu';
import { useLobby } from '../../model/lobby-context';
import SidebarDownload from '../SidebarDownload.vue';
import ChatContextMenu from './ChatContextMenu.vue';
import ChatNavigation from './ChatNavigation.vue';
import VoiceCallWidget from './VoiceCallWidget.vue';

const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const { notificationPreferences } = preferences;
const chatMenu = defineModel<FriendMenuTarget | null>('chatMenu', { required: true });

const props = withDefaults(
  defineProps<{
    user: AuthUser;
    /** The admin app, for staff only; it opens in a tab of its own. */
    adminUrl?: string | null | undefined;
    /** Open reports, shown on the admin entry. */
    adminBadge?: number | undefined;
    notificationsOpen?: boolean | undefined;
    notificationUnreadCount?: number | undefined;
    /** The call this device is in; the call card shows only while there is one. */
    activeVoice?: ActiveVoice | null | undefined;
  }>(),
  { adminUrl: null, adminBadge: 0, notificationsOpen: false, notificationUnreadCount: 0, activeVoice: null }
);

const emit = defineEmits<{
  goHome: [];
  openPeople: [];
  newChat: [];
  openSettings: [];
  openNotifications: [];
  toast: [message: string];
}>();

const selfName = computed(() => displayNameOf(props.user));
const selfPresence = computed(() =>
  normalizePresenceStatus(
    notificationPreferences.presenceStatus,
    notificationPreferences.doNotDisturb ? 'dnd' : 'online'
  )
);
const statusOptions = computed<ReadonlyArray<{ value: PresenceStatus; label: string; note?: string | undefined }>>(
  () => [
    { value: 'online', label: t('В сети') },
    {
      value: 'away',
      label: t('Отошёл'),
      note: lobby.automaticPresenceIdleAvailable ? t('Автоматически после 5 минут бездействия') : undefined
    },
    {
      value: 'dnd',
      label: t('Не беспокоить'),
      note: t('Уведомления и звуковые сигналы будут отключены')
    },
    { value: 'offline', label: t('Не в сети') }
  ]
);
const statusSaving = ref<PresenceStatus | null>(null);

function countLabel(count: number): string | number {
  return count > 99 ? '99+' : count;
}

function openAdmin(): void {
  window.open(props.adminUrl ?? '', '_blank', 'noopener');
}

async function selectStatus(value: string | undefined, close: () => void): Promise<void> {
  const status = statusOptions.value.find((option) => option.value === value)?.value;
  if (!status || statusSaving.value) return;
  if (status === selfPresence.value && !notificationPreferences.presenceStatusAutomatic) {
    close();
    return;
  }
  statusSaving.value = status;
  try {
    await preferences.updatePresenceStatus(status);
    close();
  } catch {
    emit('toast', t('Не удалось изменить статус'));
  } finally {
    statusSaving.value = null;
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__top">
      <Tooltip :text="t('Главная')" side="bottom"
        ><Pressable class="sidebar__head" @click="emit('goHome')">
          <span class="sidebar__brand-mark" role="img" aria-label="VoiceRoom"></span>
          <span class="sidebar__brand-name">VoiceRoom</span>
          <BetaMark /></Pressable
      ></Tooltip>
      <IconButton v-if="adminUrl" :label="t('Открыть админку')" :size="32" tooltip-side="bottom" @click="openAdmin">
        <LayoutDashboard aria-hidden="true" />
        <span
          v-if="adminBadge > 0"
          class="sidebar__count"
          :aria-label="t('открытых жалоб: {p0}', { p0: adminBadge })"
          >{{ countLabel(adminBadge) }}</span
        >
      </IconButton>
    </div>

    <div class="sidebar__scroll">
      <ChatNavigation
        v-model="chatMenu"
        :active-voice="activeVoice"
        @open-people="emit('openPeople')"
        @new-chat="emit('newChat')"
      />
    </div>

    <VoiceCallWidget v-if="activeVoice" :voice="activeVoice" />

    <div class="sidebar__profile">
      <DropdownMenu side="top" align="start" :aria-label="t('Статус пользователя')" focus-checked>
        <template #trigger>
          <Pressable class="sidebar__profile-user">
            <Avatar
              :name="selfName"
              :src="user.avatarUrl"
              :color-key="user.avatarColorKey"
              :background="user.avatarAccent || undefined"
              :size="32"
              :online="selfPresence === 'online'"
              :afk="selfPresence === 'away'"
              :dnd="selfPresence === 'dnd'"
              show-dot
              ring="var(--vr-surface)"
            />
            <span class="sidebar__profile-names">
              <span class="sidebar__profile-name"><EmojiText :text="selfName" /></span>
              <span class="sidebar__profile-handle">@{{ user.login }}</span>
            </span>
          </Pressable>
        </template>
        <template #content="{ close }">
          <MenuLabel :text="t('Статус')" />
          <MenuRadioGroup
            :model-value="selfPresence"
            :aria-label="t('Статус')"
            @update:model-value="(value) => selectStatus(value, close)"
          >
            <MenuRadioItem
              v-for="option in statusOptions"
              :key="option.value"
              :value="option.value"
              :label="option.label"
              :description="option.note"
              :disabled="Boolean(statusSaving)"
              @select.prevent
            >
              <template #icon>
                <span :class="['sidebar__status-dot', `sidebar__status-dot--${option.value}`]"></span>
              </template>
            </MenuRadioItem>
          </MenuRadioGroup>
        </template>
      </DropdownMenu>
      <div class="sidebar__profile-actions">
        <SidebarDownload />
        <IconButton
          :label="t('Открыть уведомления')"
          :aria-expanded="notificationsOpen"
          :size="32"
          @click="emit('openNotifications')"
        >
          <Bell aria-hidden="true" />
          <span v-if="notificationUnreadCount > 0" class="sidebar__count">{{
            countLabel(notificationUnreadCount)
          }}</span>
        </IconButton>
        <IconButton :label="t('Открыть настройки')" :size="32" @click="emit('openSettings')">
          <Settings aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <ChatContextMenu v-model="chatMenu" @toast="emit('toast', $event)" />
  </aside>
</template>
