<script setup lang="ts">
import { Bell, BellOff, Check, LayoutDashboard, Settings, UserPlus, Users } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, ref, type ComponentPublicInstance } from 'vue';
import type { AuthUser } from '@/api/auth';
import type { Friend } from '@/api/friends';
import EmojiText from '@/shared/chat/EmojiText.vue';
import BetaMark from '@/shared/components/BetaMark.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus, normalizePresenceStatus, type PresenceStatus } from '@/shared/presence';
import { AccountBadge, Avatar, Badge, Button, Popover, PopoverMenuLabel } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import { displayNameOf } from '@/shared/utils/display-name';
import type { ActiveVoice } from '../../model/active-voice';
import { useLobby } from '../../model/lobby-context';
import SidebarDownload from '../SidebarDownload.vue';
import VoiceCallWidget from './VoiceCallWidget.vue';

const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const { notificationPreferences } = preferences;

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
    { value: 'online', label: 'В сети' },
    {
      value: 'away',
      label: 'Отошёл',
      note: lobby.automaticPresenceIdleAvailable ? 'Автоматически после 5 минут бездействия' : undefined
    },
    {
      value: 'dnd',
      label: 'Не беспокоить',
      note: 'Уведомления и звуковые сигналы будут отключены'
    },
    { value: 'offline', label: 'Не в сети' }
  ]
);
const statusSaving = ref<PresenceStatus | null>(null);
const statusPopoverOpen = ref(false);
const activeStatusIndex = ref(0);
const statusOptionRefs: (HTMLButtonElement | undefined)[] = [];
let statusTypeahead = '';
let statusTypeaheadTimer: ReturnType<typeof setTimeout> | null = null;
const selectedStatusIndex = computed(() =>
  Math.max(
    0,
    statusOptions.value.findIndex((option) => option.value === selfPresence.value)
  )
);

onBeforeUnmount(() => {
  if (statusTypeaheadTimer) clearTimeout(statusTypeaheadTimer);
});

function friendPresence(entry: Friend): PresenceStatus {
  return effectivePresenceStatus(entry.online, entry.user.presenceStatus, entry.user.doNotDisturb);
}

function countLabel(count: number): string | number {
  return count > 99 ? '99+' : count;
}

function openAdmin(): void {
  window.open(props.adminUrl ?? '', '_blank', 'noopener');
}

async function focusStatusOption(index = selectedStatusIndex.value): Promise<void> {
  await nextTick();
  if (!statusPopoverOpen.value) return;
  const nextIndex = Math.min(Math.max(index, 0), statusOptions.value.length - 1);
  activeStatusIndex.value = nextIndex;
  statusOptionRefs[nextIndex]?.focus();
}

async function openStatusPopoverAndFocus(index = selectedStatusIndex.value): Promise<void> {
  activeStatusIndex.value = Math.min(Math.max(index, 0), statusOptions.value.length - 1);
  statusPopoverOpen.value = true;
  await focusStatusOption(activeStatusIndex.value);
}

function registerStatusOption(node: Element | ComponentPublicInstance | null, index: number): void {
  statusOptionRefs[index] = node instanceof HTMLButtonElement ? node : undefined;
}

function handleStatusTriggerClick(): void {
  if (statusPopoverOpen.value) {
    statusPopoverOpen.value = false;
    return;
  }
  void openStatusPopoverAndFocus(selectedStatusIndex.value);
}

function handleStatusTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    void openStatusPopoverAndFocus(selectedStatusIndex.value);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    void openStatusPopoverAndFocus(
      selectedStatusIndex.value > 0 ? selectedStatusIndex.value : statusOptions.value.length - 1
    );
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    void openStatusPopoverAndFocus(selectedStatusIndex.value);
  }
}

function moveStatusFocus(delta: number): void {
  const count = statusOptions.value.length;
  const nextIndex = (activeStatusIndex.value + delta + count) % count;
  void focusStatusOption(nextIndex);
}

function matchStatusTypeahead(char: string): void {
  if (statusTypeaheadTimer) clearTimeout(statusTypeaheadTimer);
  statusTypeahead += char.toLocaleLowerCase();
  statusTypeaheadTimer = setTimeout(() => {
    statusTypeahead = '';
    statusTypeaheadTimer = null;
  }, 700);

  const options = statusOptions.value;
  const start = (activeStatusIndex.value + 1) % options.length;
  const ordered = [...options.slice(start), ...options.slice(0, start)];
  const matched = ordered.find((option) => option.label.toLocaleLowerCase().startsWith(statusTypeahead));
  if (!matched) return;
  void focusStatusOption(options.findIndex((option) => option.value === matched.value));
}

function handleStatusOptionKeydown(
  event: KeyboardEvent,
  status: PresenceStatus,
  close: (restoreFocus?: boolean) => void
): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveStatusFocus(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveStatusFocus(-1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    void focusStatusOption(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    void focusStatusOption(statusOptions.value.length - 1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    void selectStatus(status, close);
  } else if (event.key === 'Tab') {
    close(false);
  } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    matchStatusTypeahead(event.key);
  }
}

async function selectStatus(status: PresenceStatus, close: () => void): Promise<void> {
  if (statusSaving.value) return;
  if (status === selfPresence.value && !notificationPreferences.presenceStatusAutomatic) {
    close();
    return;
  }
  statusSaving.value = status;
  try {
    await preferences.updatePresenceStatus(status);
    close();
  } catch {
    emit('toast', 'Не удалось изменить статус');
  } finally {
    statusSaving.value = null;
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__top">
      <button class="sidebar__head" type="button" title="Главная" @click="emit('goHome')">
        <span class="sidebar__brand-mark" role="img" aria-label="VoiceRoom"></span>
        <span class="sidebar__brand-name">VoiceRoom</span>
        <BetaMark />
      </button>
      <button
        v-if="adminUrl"
        class="sidebar__icon-button"
        type="button"
        title="Админка"
        aria-label="Открыть админку"
        @click="openAdmin"
      >
        <LayoutDashboard v-bind="iconSm" aria-hidden="true" />
        <span v-if="adminBadge > 0" class="sidebar__count" :aria-label="`открытых жалоб: ${adminBadge}`">{{
          countLabel(adminBadge)
        }}</span>
      </button>
    </div>

    <div class="sidebar__scroll">
      <div class="sidebar__section-head">
        <span class="sidebar__section-title"
          >Друзья<span v-if="lobby.friends.length > 0" class="sidebar__section-count">{{
            lobby.friends.length
          }}</span></span
        >
        <div class="sidebar__section-actions">
          <button
            class="sidebar__mini-button"
            type="button"
            title="Заявки и добавить друга"
            @click="emit('openPeople')"
          >
            <UserPlus v-bind="iconSm" aria-hidden="true" />
            <span v-if="lobby.incomingRequestCount > 0" class="sidebar__mini-button-dot"></span>
          </button>
        </div>
      </div>

      <div v-if="lobby.friends.length === 0" class="sidebar__empty">
        <Users v-bind="iconSm" aria-hidden="true" />
        <p>Пока нет друзей. Откройте «Заявки», чтобы добавить по логину.</p>
        <Button variant="soft" class="ui-button--compact" @click="emit('openPeople')">
          <template #icon><UserPlus v-bind="iconSm" aria-hidden="true" /></template>
          Добавить друга
        </Button>
      </div>
      <template v-else>
        <button
          v-for="entry in sortedFriends"
          :key="entry.user.id"
          class="sidebar__row"
          type="button"
          :aria-current="lobby.selectedFriendId === entry.user.id && lobby.view === 'dm' ? 'true' : undefined"
          @click="lobby.openDm(entry.user.id)"
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
            :size="30"
            ring="var(--vr-surface)"
          />
          <div class="sidebar__row-body">
            <div class="sidebar__row-title">
              <div class="sidebar__row-name">
                <EmojiText :text="displayNameOf(entry.user)" /><AccountBadge :user-id="entry.user.id" />
              </div>
              <span
                v-if="notificationPreferences.mutedPeerIds.includes(entry.user.id)"
                class="sidebar__row-muted"
                role="img"
                aria-label="Уведомления отключены"
                title="Уведомления отключены"
              >
                <BellOff v-bind="iconSm" aria-hidden="true" />
              </span>
            </div>
          </div>
          <Badge
            v-if="entry.unreadCount > 0"
            :tone="notificationPreferences.mutedPeerIds.includes(entry.user.id) ? 'muted' : 'default'"
            >{{ entry.unreadCount }}</Badge
          >
        </button>
      </template>
    </div>

    <VoiceCallWidget v-if="activeVoice" :voice="activeVoice" />

    <div class="sidebar__profile">
      <Popover
        v-model:open="statusPopoverOpen"
        placement="top-start"
        flip
        floating
        role="listbox"
        aria-label="Статус пользователя"
        panel-class="sidebar__status-popover"
      >
        <template #trigger="{ open, panelId }">
          <button
            type="button"
            class="sidebar__profile-user"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :aria-controls="panelId"
            @click="handleStatusTriggerClick"
            @keydown="handleStatusTriggerKeydown"
          >
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
          </button>
        </template>
        <template #content="{ close }">
          <PopoverMenuLabel text="Статус" />
          <div class="sidebar__status-list">
            <button
              v-for="(option, index) in statusOptions"
              :key="option.value"
              :ref="(node) => registerStatusOption(node, index)"
              class="sidebar__status-option"
              type="button"
              role="option"
              :aria-selected="selfPresence === option.value"
              :tabindex="index === activeStatusIndex ? 0 : -1"
              :disabled="Boolean(statusSaving)"
              @click="selectStatus(option.value, close)"
              @keydown="handleStatusOptionKeydown($event, option.value, close)"
              @focus="activeStatusIndex = index"
            >
              <span :class="['sidebar__status-dot', `sidebar__status-dot--${option.value}`]" aria-hidden="true"></span>
              <span class="sidebar__status-copy">
                <span class="sidebar__status-label">{{ option.label }}</span>
                <span v-if="option.note" class="sidebar__status-note">{{ option.note }}</span>
              </span>
              <Check
                v-if="selfPresence === option.value"
                v-bind="iconSm"
                class="sidebar__status-check"
                aria-hidden="true"
              />
            </button>
          </div>
        </template>
      </Popover>
      <div class="sidebar__profile-actions">
        <SidebarDownload />
        <button
          class="sidebar__icon-button"
          type="button"
          title="Уведомления"
          aria-label="Открыть уведомления"
          :aria-expanded="notificationsOpen"
          @click="emit('openNotifications')"
        >
          <Bell v-bind="iconSm" aria-hidden="true" />
          <span v-if="notificationUnreadCount > 0" class="sidebar__count">{{
            countLabel(notificationUnreadCount)
          }}</span>
        </button>
        <button
          class="sidebar__icon-button"
          type="button"
          title="Настройки"
          aria-label="Открыть настройки"
          @click="emit('openSettings')"
        >
          <Settings v-bind="iconSm" aria-hidden="true" />
        </button>
      </div>
    </div>
  </aside>
</template>
