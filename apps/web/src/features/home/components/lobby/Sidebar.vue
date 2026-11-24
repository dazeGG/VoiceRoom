<script setup lang="ts">
import { badgeOf } from '@/shared/badges';
import {
  Tooltip,
  IconButton,
  Badge,
  AccountBadge,
  Avatar,
  Button,
  DropdownMenu,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  Pressable
} from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { Bell, BellOff, LayoutDashboard, Settings, UserPlus, Users } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { AuthUser } from '@/api/auth';
import type { Friend } from '@/api/friends';
import EmojiText from '@/shared/chat/EmojiText.vue';
import BetaMark from '@/shared/components/BetaMark.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus, normalizePresenceStatus, type PresenceStatus } from '@/shared/presence';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { displayNameOf } from '@/shared/utils/display-name';
import type { ActiveVoice } from '../../model/active-voice';
import type { FriendMenuTarget } from '../../model/friend-menu';
import { useLobby } from '../../model/lobby-context';
import SidebarDownload from '../SidebarDownload.vue';
import FriendContextMenu from './FriendContextMenu.vue';
import VoiceCallWidget from './VoiceCallWidget.vue';

const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const { notificationPreferences } = preferences;
const friendMenu = defineModel<FriendMenuTarget | null>('friendMenu', { required: true });

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
  openSettings: [];
  openNotifications: [];
  toast: [message: string];
}>();

const sortedFriends = computed(() =>
  [...lobby.friends].sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
);

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

function friendPresence(entry: Friend): PresenceStatus {
  return effectivePresenceStatus(entry.online, entry.user.presenceStatus, entry.user.doNotDisturb);
}

function openFriendMenu(event: MouseEvent | KeyboardEvent, friend: Friend): void {
  if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
    return;
  }
  const anchor = event.currentTarget;
  if (!(anchor instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = anchor.getBoundingClientRect();
  friendMenu.value = {
    friend,
    anchor,
    x: event instanceof MouseEvent ? event.clientX : rect.left + 16,
    y: event instanceof MouseEvent ? event.clientY : rect.bottom
  };
}

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
      <div class="sidebar__section-head">
        <span class="sidebar__section-title"
          >{{ t('Друзья')
          }}<span v-if="lobby.friends.length > 0" class="sidebar__section-count">{{ lobby.friends.length }}</span></span
        >
        <div class="sidebar__section-actions">
          <IconButton :label="t('Заявки и добавить друга')" :size="28" @click="emit('openPeople')">
            <UserPlus aria-hidden="true" />
            <span v-if="lobby.incomingRequestCount > 0" class="sidebar__mini-button-dot"></span>
          </IconButton>
        </div>
      </div>

      <div v-if="lobby.friends.length === 0" class="sidebar__empty">
        <Users v-bind="iconSm" aria-hidden="true" />
        <p>{{ t('Пока нет друзей. Откройте «Заявки», чтобы добавить по логину.') }}</p>
        <Button variant="soft" size="sm" @click="emit('openPeople')">
          <template #icon><UserPlus v-bind="iconSm" aria-hidden="true" /></template> {{ t('Добавить друга') }}
        </Button>
      </div>
      <template v-else>
        <Pressable
          v-for="entry in sortedFriends"
          :key="entry.user.id"
          inset
          class="sidebar__row"
          aria-haspopup="menu"
          :aria-current="lobby.selectedFriendId === entry.user.id && lobby.view === 'dm' ? 'true' : undefined"
          @click="lobby.openDm(entry.user.id)"
          @contextmenu="openFriendMenu($event, entry)"
          @keydown="openFriendMenu($event, entry)"
        >
          <Avatar
            :name="displayNameOf(entry.user)"
            :src="entry.user.avatarUrl"
            :color-key="entry.user.avatarColorKey"
            :background="entry.user.avatarAccent || undefined"
            :online="friendPresence(entry) === 'online'"
            :afk="friendPresence(entry) === 'away'"
            :dnd="friendPresence(entry) === 'dnd'"
            show-dot
            :size="32"
            ring="var(--vr-surface)"
          />
          <div class="sidebar__row-body">
            <div class="sidebar__row-title">
              <div class="sidebar__row-name">
                <EmojiText :text="displayNameOf(entry.user)" /><AccountBadge :badge="badgeOf(entry.user.id)" />
              </div>
              <span
                v-if="notificationPreferences.mutedPeerIds.includes(entry.user.id)"
                class="sidebar__row-muted"
                role="img"
                :aria-label="t('Уведомления отключены')"
                :title="t('Уведомления отключены')"
              >
                <BellOff v-bind="iconSm" aria-hidden="true" />
              </span>
            </div>
          </div>
          <Badge
            v-if="entry.unreadCount > 0"
            :tone="notificationPreferences.mutedPeerIds.includes(entry.user.id) ? 'muted' : 'accent'"
            :count="entry.unreadCount"
          />
        </Pressable>
      </template>
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
    <FriendContextMenu v-model="friendMenu" @toast="emit('toast', $event)" />
  </aside>
</template>
